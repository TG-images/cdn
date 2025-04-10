const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const asyncHandler = require('express-async-handler');
const bcrypt = require('bcrypt');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const proxyRouter = require('./routes/proxy');

// 加载环境变量
dotenv.config();

const app = express();

// D1 数据库连接
const { DB } = process.env;
if (!DB) {
    console.error('错误: 未配置 D1 数据库');
    process.exit(1);
}

// 数据库中间件
app.use((req, res, next) => {
    req.db = DB;
    next();
});

// 会话配置
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 24小时
        httpOnly: true,
        name: 'tg_file_session'
    }
}));

// 中间件配置
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 路由配置
app.use('/api', require('./routes/upload'));
app.use('/api/folders', require('./routes/folders'));

// 确保API响应返回正确的Content-Type
app.use('/api', (req, res, next) => {
    res.setHeader('Content-Type', 'application/json');
    next();
});

// 登录中间件
function requireLogin(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        // 如果是API请求，返回401状态码
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: '请先登录' });
        }
        // 如果是页面请求，重定向到登录页
        res.redirect('/login.html');
    }
}

// 根路径重定向
app.get('/', (req, res) => {
    if (!req.session.userId) {
        res.redirect('/login.html');
    } else {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// 登录页面不需要登录验证
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 代理路由 - 确保在登录验证之前，这样预览功能不需要登录
app.use('/proxy', proxyRouter);

// 文件下载路由 - 确保在登录验证之前，这样文件下载功能不需要登录
app.use('/api/files', require('./routes/files'));

// 其他路由需要登录验证
app.use(requireLogin);

// 配置静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

// 通配符路由，处理所有其他请求
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 初始化数据库表
async function initDatabase() {
    try {
        // 创建文件表
        await DB.prepare(`CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            size INTEGER,
            tg_file_id TEXT,
            parent_id INTEGER,
            is_folder BOOLEAN DEFAULT 0,
            caption TEXT,
            created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
            FOREIGN KEY (parent_id) REFERENCES files (id) ON DELETE SET NULL
        )`).run();
        
        console.log('Files table initialized');
        
        // 创建用户表
        await DB.prepare(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`).run();
        
        console.log('Users table initialized');
        
        // 检查是否已有管理员账户
        await checkAndCreateAdminUser();
    } catch (err) {
        console.error('Error initializing database:', err);
    }
}

// 检查并创建默认管理员账户
async function checkAndCreateAdminUser() {
    const defaultUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
    const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
    
    try {
        // 检查管理员用户是否存在
        const user = await DB.prepare('SELECT * FROM users WHERE username = ?')
            .bind(defaultUsername)
            .first();
        
        if (!user) {
            // 哈希加密密码
            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash(defaultPassword, saltRounds);
            
            // 创建默认管理员用户
            await DB.prepare('INSERT INTO users (username, password) VALUES (?, ?)')
                .bind(defaultUsername, hashedPassword)
                .run();
                
            console.log(`Default admin user '${defaultUsername}' created successfully`);
        } else {
            console.log('Admin user already exists');
        }
    } catch (error) {
        console.error('Error checking/creating admin user:', error);
    }
}

// 验证reCAPTCHA token
async function verifyRecaptcha(token) {
    const secretKey = process.env.RECAPTCHA_SECRET_KEY;
    if (!secretKey) {
        return { success: true }; // 如果未配置reCAPTCHA，则跳过验证
    }
    
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: `secret=${secretKey}&response=${token}`
    });
    
    return await response.json();
}

// 获取文件夹大小
app.get('/api/folders/:id/size', asyncHandler(async (req, res) => {
    const { id } = req.params;
    try {
        const result = await DB.prepare(
            `WITH RECURSIVE
            subfolder(id) AS (
                SELECT id FROM files WHERE id = ?
                UNION ALL
                SELECT files.id FROM files, subfolder
                WHERE files.parent_id = subfolder.id
            )
            SELECT SUM(size) as total_size
            FROM files
            WHERE id IN subfolder`
        ).bind(id).first();
        
        res.json({ size: result?.total_size || 0 });
    } catch (err) {
        console.error('Error calculating folder size:', err);
        return res.status(500).json({ error: 'Failed to calculate size' });
    }
}));

// 导出app实例，供Cloudflare Pages使用
module.exports = app; 