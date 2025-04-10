const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const FormData = require('form-data');

// 验证环境变量
function validateEnvVariables() {
    if (!process.env.BOT_TOKEN || process.env.BOT_TOKEN === 'your_bot_token_here') {
        throw new Error('Invalid BOT_TOKEN in environment variables');
    }
    if (!process.env.CHAT_ID || process.env.CHAT_ID === 'your_chat_id_here') {
        throw new Error('Invalid CHAT_ID in environment variables');
    }
}

// 上传到 Telegram
async function uploadToTelegram(fileBuffer, fileName) {
    try {
        validateEnvVariables();

        const form = new FormData();
        form.append('document', fileBuffer, fileName);
        
        const options = {
            chat_id: process.env.CHAT_ID,
            caption: fileName
        };
        
        Object.entries(options).forEach(([key, value]) => {
            form.append(key, value);
        });

        const response = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendDocument`, {
            method: 'POST',
            body: form
        });

        const result = await response.json();

        if (!result.ok) {
            throw new Error(result.description || 'Failed to upload to Telegram');
        }

        return {
            tg_file_id: `${process.env.CHAT_ID}:${result.result.message_id}`
        };
    } catch (error) {
        throw error;
    }
}

// 保存文件信息到数据库
async function saveFileToDatabase(db, fileInfo) {
    const { name, size, tg_file_id, parent_id } = fileInfo;
    
    // 从 tg_file_id 中提取 message_id
    const message_id = tg_file_id.includes(':') ? tg_file_id.split(':')[1] : tg_file_id;
    
    const result = await db.prepare(
        `INSERT INTO files (filename, file_size, file_id, message_id, parent_id, is_folder, created_at)
         VALUES (?, ?, ?, ?, ?, 0, datetime('now', '+8 hours'))
         RETURNING id`
    ).bind(name, size, tg_file_id, message_id, parent_id).first();
    
    return result.id;
}

// 处理文件上传的路由
router.post('/', async (req, res) => {
    try {
        validateEnvVariables();

        if (!req.files || !req.files.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const file = req.files.file;
        const fileName = file.name;
        
        // 上传到 Telegram
        const { tg_file_id } = await uploadToTelegram(file.data, fileName);

        // 将文件信息保存到数据库
        const fileInfo = {
            name: fileName,
            size: file.size,
            tg_file_id: tg_file_id,
            parent_id: req.body.parent_id || null
        };

        // 保存到 D1 数据库
        const fileId = await saveFileToDatabase(req.db, fileInfo);
        
        // 格式化响应数据
        const responseData = {
            id: fileId,
            filename: fileName,
            file_size: file.size,
            file_id: tg_file_id,
            message_id: tg_file_id.includes(':') ? tg_file_id.split(':')[1] : tg_file_id,
            parent_id: req.body.parent_id || null,
            is_folder: 0,
            created_at: new Date().toISOString()
        };

        res.json({
            success: true,
            file: responseData
        });
    } catch (error) {
        res.status(500).json({
            error: 'Upload failed',
            message: error.message,
            stack: error.stack
        });
    }
});

module.exports = router; 