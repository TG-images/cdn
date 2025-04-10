const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { eq } = require('drizzle-orm');
const { files } = require('../db/schema');
const { createDB } = require('../db');
const { promisify } = require('util');
const fetch = require('node-fetch');
const FormData = require('form-data');

// 配置 multer 存储
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, '../uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ storage: storage });

// 验证环境变量
function validateEnvVariables() {
    console.log('Validating environment variables...');
    if (!process.env.BOT_TOKEN || process.env.BOT_TOKEN === 'your_bot_token_here') {
        console.error('Invalid BOT_TOKEN:', process.env.BOT_TOKEN);
        throw new Error('Invalid BOT_TOKEN in environment variables');
    }
    if (!process.env.CHAT_ID || process.env.CHAT_ID === 'your_chat_id_here') {
        console.error('Invalid CHAT_ID:', process.env.CHAT_ID);
        throw new Error('Invalid CHAT_ID in environment variables');
    }
    console.log('Environment variables validated successfully');
}

// 上传到 Telegram
async function uploadToTelegram(filePath, fileName) {
    try {
        console.log('Starting Telegram upload for file:', fileName);
        console.log('File path:', filePath);
        
        // 验证环境变量
        validateEnvVariables();

        const form = new FormData();
        form.append('document', fs.createReadStream(filePath));
        
        const options = {
            chat_id: process.env.CHAT_ID,
            caption: fileName
        };
        
        // 将选项添加到表单
        Object.entries(options).forEach(([key, value]) => {
            form.append(key, value);
        });

        console.log('Sending request to Telegram API...');
        const response = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendDocument`, {
            method: 'POST',
            body: form
        });

        const result = await response.json();
        console.log('Telegram API response:', result);

        if (!result.ok) {
            console.error('Telegram API error:', result);
            throw new Error(result.description || 'Failed to upload to Telegram');
        }

        // 返回 tg_file_id
        return {
            tg_file_id: `${process.env.CHAT_ID}:${result.result.message_id}`
        };
    } catch (error) {
        console.error('Telegram upload error:', error);
        if (error.response) {
            console.error('Error response:', await error.response.text());
        }
        throw error;
    } finally {
        // 删除临时文件
        try {
            await promisify(fs.unlink)(filePath);
            console.log('Temporary file deleted:', filePath);
        } catch (error) {
            console.error('Error deleting temp file:', error);
        }
    }
}

// 文件上传路由
router.post('/', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '没有文件被上传' });
        }

        const filePath = req.file.path;
        const fileName = req.file.originalname;
        const fileSize = req.file.size;
        const caption = req.body.caption || '';
        const parentId = req.body.parentId || null;

        // 上传到 Telegram
        const form = new FormData();
        form.append('document', fs.createReadStream(filePath));
        form.append('chat_id', process.env.CHAT_ID);
        if (caption) {
            form.append('caption', caption);
        }

        const response = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendDocument`, {
            method: 'POST',
            body: form
        });

        const result = await response.json();

        if (!result.ok) {
            console.error('Telegram API error:', result);
            return res.status(500).json({ error: '上传到Telegram失败' });
        }

        // 获取文件ID
        const fileId = result.result.document.file_id;

        // 删除临时文件
        fs.unlinkSync(filePath);

        // 保存文件信息到数据库
        const db = createDB(req.app.locals.db);
        const [fileRecord] = await db.insert(files).values({
            name: fileName,
            size: fileSize,
            tgFileId: fileId,
            parentId: parentId ? parseInt(parentId) : null,
            isFolder: false,
            caption: caption || null,
            userId: req.session.userId
        }).returning();

        return res.json({
            success: true,
            file: fileRecord
        });
    } catch (error) {
        console.error('文件上传错误:', error);
        return res.status(500).json({ error: '文件上传失败' });
    }
});

module.exports = router; 