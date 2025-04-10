const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const asyncHandler = require('express-async-handler');
const bcrypt = require('bcrypt');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const { drizzle } = require('drizzle-orm/d1');
const { files, users } = require('./db/schema');
const { eq, sql } = require('drizzle-orm');

// 配置日志 - 使用 Cloudflare 的日志系统
// 在 Cloudflare Pages 中，日志会自动收集并可在 Cloudflare Dashboard 中查看
// 不需要手动写入文件系统

// 加载环境变量
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// 会话配置
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET || 'telegram-file-manager-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24小时
    }
}));

// 中间件设置
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// 请求日志中间件
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    next();
});

// 导入路由
const uploadRouter = require('./routes/upload');
const previewRouter = require('./routes/preview');

// 注册路由
app.use('/api/upload', uploadRouter);
app.use('/api/preview', previewRouter);

// 创建数据库连接
function createDB(db) {
    return drizzle(db, { schema: { files, users } });
}

// 检查并创建默认管理员账户
async function checkAndCreateAdminUser(db) {
    const defaultUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
    const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
    
    try {
        // 查找管理员用户
        const user = await db.select().from(users).where(eq(users.username, defaultUsername)).get();
        
        if (!user) {
            // 哈希加密密码
            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash(defaultPassword, saltRounds);
            
            // 创建默认管理员用户
            await db.insert(users).values({
                username: defaultUsername,
                password: hashedPassword
            });
            console.log(`Default admin user '${defaultUsername}' created successfully`);
        } else {
            console.log('Admin user already exists');
        }
    } catch (error) {
        console.error('Error checking admin user:', error);
    }
}

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

// 应用登录中间件到所有需要保护的路由
app.use((req, res, next) => {
    // 如果是webhook请求，直接通过
    if (req.path === '/webhook') {
        return next();
    }
    
    // 不需要登录的路由
    const publicPaths = [
        '/login.html',
        '/css',
        '/js/login.js',
        '/api/login',
        '/api/recaptcha'
    ];
    
    // 检查请求路径是否在公开路径列表中
    const isPublicPath = publicPaths.some(path => req.path.startsWith(path));
    
    if (isPublicPath) {
        next();
    } else {
        requireLogin(req, res, next);
    }
});

// 登录接口
app.post('/api/login', asyncHandler(async (req, res) => {
    const { username, password, recaptchaToken } = req.body;
    
    // 验证reCAPTCHA token
    if (process.env.RECAPTCHA_SECRET_KEY) {
        try {
            const recaptchaResponse = await verifyRecaptcha(recaptchaToken);
            if (!recaptchaResponse.success) {
                return res.status(400).json({ error: 'reCAPTCHA验证失败，请重试' });
            }
        } catch (error) {
            console.error('reCAPTCHA verification error:', error);
            return res.status(500).json({ error: '验证失败，请重试' });
        }
    }
    
    // 验证用户名和密码
    const db = createDB(req.app.locals.db);
    const user = await db.select().from(users).where(eq(users.username, username)).get();
    
    if (!user) {
        return res.status(401).json({ error: '用户名或密码错误' });
    }
    
    // 验证密码
    try {
        const match = await bcrypt.compare(password, user.password);
        if (match) {
            // 设置会话
            req.session.userId = user.id;
            req.session.username = user.username;
            res.json({ success: true });
        } else {
            res.status(401).json({ error: '用户名或密码错误' });
        }
    } catch (error) {
        console.error('Password comparison error:', error);
        res.status(500).json({ error: '服务器错误' });
    }
}));

// 退出登录接口
app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ error: '退出失败' });
        }
        res.json({ success: true });
    });
});

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

// 修改密码接口
app.post('/api/change-password', requireLogin, asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const userId = req.session.userId;
    
    // 验证当前密码
    const db = createDB(req.app.locals.db);
    const user = await db.select().from(users).where(eq(users.id, userId)).get();
    
    if (!user) {
        return res.status(500).json({ error: '服务器错误' });
    }
    
    try {
        const match = await bcrypt.compare(currentPassword, user.password);
        if (!match) {
            return res.status(401).json({ error: '当前密码错误' });
        }
        
        // 哈希新密码
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
        
        // 更新密码
        await db.update(users).set({
            password: hashedPassword
        }).where(eq(users.id, userId));
        
        res.json({ success: true });
    } catch (error) {
        console.error('Password update error:', error);
        res.status(500).json({ error: '服务器错误' });
    }
}));

// 获取当前用户信息
app.get('/api/user', requireLogin, (req, res) => {
    res.json({
        id: req.session.userId,
        username: req.session.username
    });
});

// Telegram webhook 端点
app.post('/webhook', asyncHandler(async (req, res) => {
    console.log('Received webhook data:', JSON.stringify(req.body, null, 2));
    
    try {
        const message = req.body.message;
        if (!message) {
            console.log('No message in webhook data');
            return res.status(200).json({ error: 'No message in webhook data' });
        }

        console.log('Processing message:', JSON.stringify(message, null, 2));
        
        // 获取文件信息
        let file, fileName, fileSize, fileType;
        
        // 检查所有可能的文件类型
        if (message.document) {
            file = message.document;
            fileName = file.file_name || 'document_' + Date.now();
            fileSize = file.file_size;
            fileType = 'document';
            console.log('Found document:', file);
        } else if (message.video) {
            file = message.video;
            fileName = file.file_name || 'video_' + Date.now() + '.mp4';
            fileSize = file.file_size;
            fileType = 'video';
            console.log('Found video:', file);
        } else if (message.audio) {
            file = message.audio;
            fileName = file.file_name || 'audio_' + Date.now() + '.mp3';
            fileSize = file.file_size;
            fileType = 'audio';
            console.log('Found audio:', file);
        } else if (message.photo && message.photo.length > 0) {
            file = message.photo[message.photo.length - 1]; // 获取最大尺寸的图片
            fileName = 'photo_' + Date.now() + '.jpg';
            fileSize = file.file_size;
            fileType = 'photo';
            console.log('Found photo:', file);
        } else {
            console.log('No supported file type found in message');
            return res.status(200).json({ error: 'No supported file type found' });
        }

        // 清理文件名（移除不安全的字符）
        fileName = fileName.replace(/[/\\?%*:|"<>]/g, '-');

        console.log('File information:', {
            fileName,
            fileSize,
            fileType,
            file
        });

        // 构建文件标识符
        const chatId = message.chat.id.toString().startsWith('-100') ? message.chat.id : `-100${message.chat.id}`;
        const fileIdentifier = `${chatId}:${message.message_id}`;
        console.log('Generated file identifier:', fileIdentifier);

        // 获取caption
        const caption = message.caption || '';
        console.log('Message caption:', caption);

        // 插入文件信息到数据库
        const db = createDB(req.app.locals.db);
        await db.insert(files).values({
            name: fileName,
            size: fileSize,
            tg_file_id: fileIdentifier,
            parent_id: null,
            is_folder: false,
            caption: caption
        }).returning({ id: files.id }).get();
        
        const fileInfo = {
            id: this.lastID,
            name: fileName,
            size: fileSize,
            tg_file_id: fileIdentifier,
            is_folder: false,
            parent_id: null,
            caption: caption,
            created_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()
        };
        console.log('File saved successfully:', fileInfo);
        
        res.status(200).json({ 
            success: true, 
            file: fileInfo
        });
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(200).json({ error: 'Internal server error', details: error.message });
    }
}));

// 获取文件列表
app.get('/api/files', asyncHandler(async (req, res) => {
    const parentId = req.query.parent_id;
    const all = req.query.all === 'true';
    const db = createDB(req.app.locals.db);
    
    let query;
    if (all) {
        query = db.select().from(files).orderBy(files.createdAt.asc());
    } else if (parentId === undefined || parentId === '') {
        query = db.select().from(files).where(eq(files.parentId, null)).orderBy(files.createdAt.asc());
    } else {
        query = db.select().from(files).where(eq(files.parentId, parseInt(parentId))).orderBy(files.createdAt.asc());
    }
    
    const files = await query.limit(100).all();
    res.json(files);
}));

// 创建文件夹
app.post('/api/folders', asyncHandler(async (req, res) => {
    const { name, parentId } = req.body;
    const db = createDB(req.app.locals.db);
    const [result] = await db.insert(files).values({
        name: name,
        isFolder: true,
        parentId: parentId ? parseInt(parentId) : null
    }).returning();
    
    res.json({ id: result.id, success: true });
}));

// 移动文件
app.put('/api/files/:id/move', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { newParentId } = req.body;
    const db = createDB(req.app.locals.db);
    const [result] = await db.update(files)
        .set({ parentId: newParentId ? parseInt(newParentId) : null })
        .where(eq(files.id, parseInt(id)))
        .returning();
    
    if (result) {
        res.json({ success: true });
    } else {
        res.status(500).json({ error: 'Failed to move file' });
    }
}));

// 删除文件或文件夹
app.delete('/api/files/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const db = createDB(req.app.locals.db);
    const [result] = await db.delete(files)
        .where(eq(files.id, parseInt(id)))
        .returning();
    
    if (result) {
        // 如果是文件夹，递归删除所有子文件
        if (result.isFolder) {
            await db.delete(files).where(eq(files.parentId, parseInt(id)));
        }
        res.json({ success: true });
    } else {
        res.status(500).json({ error: 'Failed to delete' });
    }
}));

// 重命名文件或文件夹
app.put('/api/files/:id/rename', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { newName } = req.body;
    
    if (!newName || newName.trim() === '') {
        return res.status(400).json({ error: '新名称不能为空' });
    }
    
    const db = createDB(req.app.locals.db);
    const [result] = await db.update(files)
        .set({ name: newName.trim() })
        .where(eq(files.id, parseInt(id)))
        .returning();
    
    if (result) {
        res.json({ success: true });
    } else {
        res.status(500).json({ error: '重命名失败' });
    }
}));

// 处理Telegram文件下载
app.get('/api/files/download/:id', asyncHandler(async (req, res) => {
    try {
        const { id } = req.params;
        console.log('Download request for file:', id);
        
        // 查询数据库获取文件信息
        const db = createDB(req.app.locals.db);
        const file = await db.select().from(files).where(eq(files.id, parseInt(id))).get();
        
        if (!file) {
            console.log('File not found:', id);
            return res.status(404).json({ error: '文件不存在' });
        }
        
        console.log('File found:', file);
        
        // 如果tg_file_id为空
        if (!file.tg_file_id) {
            console.log('Invalid file ID:', file);
            return res.status(400).json({ error: '无效的Telegram文件ID' });
        }
        
        // 解析文件标识符
        const [chatId, messageId] = file.tg_file_id.split(':');
        if (!chatId || !messageId) {
            console.log('Invalid file identifier format:', file.tg_file_id);
            return res.status(400).json({ error: '无效的文件链接格式' });
        }
        
        console.log('Parsed file identifier:', { chatId, messageId });
        
        // 构建Telegram链接
        let telegramUrl;
        
        try {
            // 处理不同类型的群组/频道ID
            if (chatId.startsWith('-100')) {
                // 私有频道/超级群组
                const channelId = chatId.substring(4);
                telegramUrl = `https://t.me/c/${channelId}/${messageId}`;
            } else if (chatId.startsWith('-')) {
                // 普通群组
                const groupId = chatId.substring(1);
                telegramUrl = `https://t.me/c/${groupId}/${messageId}`;
            } else if (chatId.startsWith('@')) {
                // 公开频道
                const channelName = chatId.substring(1);
                telegramUrl = `https://t.me/${channelName}/${messageId}`;
            } else {
                // 其他格式，尝试作为频道ID处理
                telegramUrl = `https://t.me/c/${chatId}/${messageId}`;
            }
            
            console.log('Generated URL:', telegramUrl);
            
            // 直接重定向到Telegram链接
            res.redirect(telegramUrl);
        } catch (error) {
            console.error('Error generating Telegram URL:', error);
            return res.status(500).json({ error: '生成Telegram链接失败', details: error.message });
        }
    } catch (error) {
        console.error('Download request error:', error);
        res.status(500).json({ error: '处理下载请求失败', details: error.message });
    }
}));

// 获取文件夹大小
app.get('/api/folders/:id/size', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const db = createDB(req.app.locals.db);
    const result = await db.select({
        totalSize: sql`sum(${files.size})`
    })
    .from(files)
    .where(eq(files.parentId, parseInt(id)))
    .get();
    
    res.json({ size: result?.totalSize || 0 });
}));

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
}); 