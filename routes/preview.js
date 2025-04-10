const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const { createDB } = require('../db');
const { files } = require('../db/schema');
const { eq } = require('drizzle-orm');

// 检查环境变量
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
console.log('Environment check - BOT_TOKEN exists:', !!BOT_TOKEN);
console.log('Environment check - CHAT_ID exists:', !!CHAT_ID);

// 从消息中获取文件ID
async function getFileIdFromMessage(messageId) {
    try {
        // 确保CHAT_ID格式正确
        const formattedChatId = CHAT_ID.startsWith('-100') ? CHAT_ID : `-100${CHAT_ID.replace(/^-/, '')}`;
        
        const response = await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${messageId}`
        );

        // 如果直接使用messageId成功，说明它已经是file_id
        if (response.ok) {
            return messageId;
        }

        // 如果直接使用失败，尝试从消息中获取
        const msgResponse = await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/getMessage?chat_id=${formattedChatId}&message_id=${messageId}`
        );

        if (!msgResponse.ok) {
            const error = await msgResponse.json();
            throw new Error(`Failed to get message: ${error.description || msgResponse.statusText}`);
        }

        const data = await msgResponse.json();
        const message = data.result;

        // 检查所有可能的文件类型
        if (message.document) {
            return message.document.file_id;
        } else if (message.photo) {
            // 对于照片，使用最大尺寸的版本
            return message.photo[message.photo.length - 1].file_id;
        } else if (message.video) {
            return message.video.file_id;
        } else if (message.audio) {
            return message.audio.file_id;
        } else if (message.voice) {
            return message.voice.file_id;
        } else if (message.video_note) {
            return message.video_note.file_id;
        }

        throw new Error('No file found in message');
    } catch (error) {
        console.error('Error getting file ID from message:', error);
        throw error;
    }
}

// 处理文件预览请求
router.get('/:fileId', async (req, res) => {
    let fileResponse = null;
    try {
        const { fileId } = req.params;
        console.log('Processing preview request for file ID:', fileId);

        // 查询数据库获取文件信息
        const db = createDB(req.app.locals.db);
        const file = await db.select().from(files).where(eq(files.tgFileId, fileId)).get();

        if (!file) {
            console.log('File not found:', fileId);
            return res.status(404).json({
                error: 'File not found',
                message: '文件不存在'
            });
        }

        // 获取Telegram文件信息
        if (!BOT_TOKEN) {
            return res.status(500).json({
                error: 'Configuration error',
                message: '服务器配置错误',
                details: '无法访问 Bot Token'
            });
        }

        // 从文件ID中提取消息ID
        const messageId = file.tg_file_id.includes(':') ? file.tg_file_id.split(':')[1] : file.tg_file_id;
        console.log('Extracted message ID:', messageId);

        // 获取实际的文件ID
        const actualFileId = await getFileIdFromMessage(messageId);
        console.log('Got actual file ID:', actualFileId);

        // 获取文件路径
        console.log('Getting file path from Telegram...');
        const tgResponse = await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${actualFileId}`,
            {
                timeout: 10000
            }
        );

        if (!tgResponse.ok) {
            const errorData = await tgResponse.json().catch(() => ({}));
            console.error('Telegram API error:', errorData);
            return res.status(502).json({
                error: 'Telegram API error',
                message: '无法从Telegram获取文件',
                details: errorData.description || tgResponse.statusText
            });
        }

        const tgData = await tgResponse.json();
        if (!tgData.ok || !tgData.result.file_path) {
            console.error('Invalid response from Telegram:', tgData);
            return res.status(502).json({
                error: 'Telegram API error',
                message: '无法从Telegram获取文件'
            });
        }

        // 构建文件URL并转发请求
        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${tgData.result.file_path}`;
        console.log('Proxying file from:', fileUrl);

        // 获取文件内容
        fileResponse = await fetch(fileUrl, {
            headers: req.headers.range ? {
                'Range': req.headers.range
            } : {}
        });
        
        if (!fileResponse.ok) {
            console.error('Failed to download file:', fileResponse.statusText);
            return res.status(502).json({
                error: 'Download failed',
                message: '文件下载失败'
            });
        }

        // 转发所有响应头
        for (const [key, value] of fileResponse.headers) {
            // 跳过一些不需要的头
            if (['connection', 'keep-alive', 'transfer-encoding'].includes(key.toLowerCase())) {
                continue;
            }
            res.setHeader(key, value);
        }

        // 如果是范围请求，设置正确的状态码
        if (fileResponse.status === 206) {
            res.status(206);
        }

        // 流式传输文件内容
        fileResponse.body.pipe(res);

        // 错误处理
        fileResponse.body.on('error', (error) => {
            console.error('Stream error:', error);
            if (!res.headersSent) {
                res.status(500).json({
                    error: 'Streaming error',
                    message: '文件传输错误'
                });
            } else {
                try {
                    res.end();
                } catch (e) {
                    console.error('Failed to end response:', e);
                }
            }
        });

    } catch (error) {
        console.error('Preview error:', error);
        
        // 清理资源
        if (fileResponse && fileResponse.body) {
            try {
                fileResponse.body.destroy();
            } catch (e) {
                console.error('Failed to destroy file response stream:', e);
            }
        }

        if (!res.headersSent) {
            res.status(500).json({
                error: 'Internal server error',
                message: '服务器内部错误',
                details: error.message
            });
        } else {
            try {
                res.end();
            } catch (e) {
                console.error('Failed to end response:', e);
            }
        }
    }
});

module.exports = router; 