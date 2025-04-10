const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

// 检查环境变量
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
console.log('Environment check - BOT_TOKEN exists:', !!BOT_TOKEN);
console.log('Environment check - CHAT_ID exists:', !!CHAT_ID);

// 从消息中获取文件ID
async function getFileIdFromMessage(messageId) {
    try {
        const formattedChatId = CHAT_ID.startsWith('-100') ? CHAT_ID : `-100${CHAT_ID.replace(/^-/, '')}`;
        
        const response = await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${messageId}`
        );

        if (response.ok) {
            return messageId;
        }

        const msgResponse = await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/getMessage?chat_id=${formattedChatId}&message_id=${messageId}`
        );

        if (!msgResponse.ok) {
            const error = await msgResponse.json();
            throw new Error(`Failed to get message: ${error.description || msgResponse.statusText}`);
        }

        const data = await msgResponse.json();
        const message = data.result;

        if (message.document) {
            return message.document.file_id;
        } else if (message.photo) {
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
        throw error;
    }
}

// 处理文件预览请求
router.get('/:fileId', async (req, res) => {
    let fileResponse = null;
    try {
        const { fileId } = req.params;

        // 从 D1 数据库获取文件信息
        const file = await req.db.prepare(
            'SELECT * FROM files WHERE tg_file_id = ?'
        ).bind(fileId).first();

        if (!file) {
            return res.status(404).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>文件不存在</title>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <style>
                        body { font-family: system-ui; padding: 2rem; text-align: center; }
                        .error-container { max-width: 600px; margin: 0 auto; }
                        .error-title { color: #dc3545; }
                        .error-message { color: #6c757d; margin: 1rem 0; }
                        .back-button { 
                            display: inline-block;
                            padding: 0.5rem 1rem;
                            background-color: #0d6efd;
                            color: white;
                            text-decoration: none;
                            border-radius: 0.25rem;
                        }
                        .back-button:hover { background-color: #0b5ed7; }
                    </style>
                </head>
                <body>
                    <div class="error-container">
                        <h1 class="error-title">文件不存在</h1>
                        <p class="error-message">抱歉，您请求的文件不存在或已被删除。</p>
                        <a href="javascript:history.back()" class="back-button">返回上一页</a>
                    </div>
                </body>
                </html>
            `);
        }

        if (!BOT_TOKEN) {
            return res.status(500).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>服务器配置错误</title>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <style>
                        body { font-family: system-ui; padding: 2rem; text-align: center; }
                        .error-container { max-width: 600px; margin: 0 auto; }
                        .error-title { color: #dc3545; }
                        .error-message { color: #6c757d; margin: 1rem 0; }
                        .back-button { 
                            display: inline-block;
                            padding: 0.5rem 1rem;
                            background-color: #0d6efd;
                            color: white;
                            text-decoration: none;
                            border-radius: 0.25rem;
                        }
                        .back-button:hover { background-color: #0b5ed7; }
                    </style>
                </head>
                <body>
                    <div class="error-container">
                        <h1 class="error-title">服务器配置错误</h1>
                        <p class="error-message">抱歉，服务器配置出现问题，无法访问文件。</p>
                        <a href="javascript:history.back()" class="back-button">返回上一页</a>
                    </div>
                </body>
                </html>
            `);
        }

        const messageId = file.tg_file_id.includes(':') ? file.tg_file_id.split(':')[1] : file.tg_file_id;
        const actualFileId = await getFileIdFromMessage(messageId);

        const tgResponse = await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${actualFileId}`,
            {
                timeout: 10000,
                headers: {
                    'Accept': '*/*'
                }
            }
        );

        if (!tgResponse.ok) {
            const errorData = await tgResponse.json().catch(() => ({}));
            return res.status(502).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>无法获取文件</title>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <style>
                        body { font-family: system-ui; padding: 2rem; text-align: center; }
                        .error-container { max-width: 600px; margin: 0 auto; }
                        .error-title { color: #dc3545; }
                        .error-message { color: #6c757d; margin: 1rem 0; }
                        .back-button { 
                            display: inline-block;
                            padding: 0.5rem 1rem;
                            background-color: #0d6efd;
                            color: white;
                            text-decoration: none;
                            border-radius: 0.25rem;
                        }
                        .back-button:hover { background-color: #0b5ed7; }
                    </style>
                </head>
                <body>
                    <div class="error-container">
                        <h1 class="error-title">无法获取文件</h1>
                        <p class="error-message">抱歉，无法从Telegram获取文件。</p>
                        <a href="javascript:history.back()" class="back-button">返回上一页</a>
                    </div>
                </body>
                </html>
            `);
        }

        const tgData = await tgResponse.json();
        if (!tgData.ok || !tgData.result.file_path) {
            return res.status(502).json({
                error: 'Telegram API error',
                message: '无法从Telegram获取文件'
            });
        }

        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${tgData.result.file_path}`;
        fileResponse = await fetch(fileUrl, {
            headers: req.headers.range ? {
                'Range': req.headers.range
            } : {}
        });
        
        if (!fileResponse.ok) {
            return res.status(502).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>文件下载失败</title>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <style>
                        body { font-family: system-ui; padding: 2rem; text-align: center; }
                        .error-container { max-width: 600px; margin: 0 auto; }
                        .error-title { color: #dc3545; }
                        .error-message { color: #6c757d; margin: 1rem 0; }
                        .back-button { 
                            display: inline-block;
                            padding: 0.5rem 1rem;
                            background-color: #0d6efd;
                            color: white;
                            text-decoration: none;
                            border-radius: 0.25rem;
                        }
                        .back-button:hover { background-color: #0b5ed7; }
                    </style>
                </head>
                <body>
                    <div class="error-container">
                        <h1 class="error-title">文件下载失败</h1>
                        <p class="error-message">抱歉，文件下载过程中出现错误。</p>
                        <a href="javascript:history.back()" class="back-button">返回上一页</a>
                    </div>
                </body>
                </html>
            `);
        }

        // 设置正确的Content-Type
        const fileName = file.name.toLowerCase();
        let contentType = 'application/octet-stream';
        
        // 根据文件扩展名设置合适的Content-Type
        if (fileName.endsWith('.js')) contentType = 'application/javascript';
        else if (fileName.endsWith('.css')) contentType = 'text/css';
        else if (fileName.endsWith('.html')) contentType = 'text/html';
        else if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) contentType = 'image/jpeg';
        else if (fileName.endsWith('.png')) contentType = 'image/png';
        else if (fileName.endsWith('.gif')) contentType = 'image/gif';
        else if (fileName.endsWith('.webp')) contentType = 'image/webp';
        else if (fileName.endsWith('.pdf')) contentType = 'application/pdf';
        else if (fileName.endsWith('.mp4')) contentType = 'video/mp4';
        else if (fileName.endsWith('.webm')) contentType = 'video/webm';
        else if (fileName.endsWith('.mp3')) contentType = 'audio/mpeg';
        else if (fileName.endsWith('.wav')) contentType = 'audio/wav';
        else if (fileName.endsWith('.m3u8')) contentType = 'application/vnd.apple.mpegurl';
        else if (fileName.endsWith('.ts')) contentType = 'video/mp2t';
        else if (fileName.endsWith('.srt') || fileName.endsWith('.vtt')) contentType = 'text/plain';
        else if (fileName.endsWith('.ass')) contentType = 'text/plain';
        
        // 设置Content-Type和其他必要的头部
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.name)}"`);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        
        // 设置其他响应头
        for (const [key, value] of fileResponse.headers) {
            if (['connection', 'keep-alive', 'transfer-encoding', 'content-type', 'content-disposition', 'access-control-allow-origin'].includes(key.toLowerCase())) {
                continue;
            }
            res.setHeader(key, value);
        }

        if (fileResponse.status === 206) {
            res.status(206);
        }

        fileResponse.body.pipe(res);

        fileResponse.body.on('error', (error) => {
            if (!res.headersSent) {
                res.status(500).json({
                    error: 'Streaming error',
                    message: '文件传输错误'
                });
            } else {
                try {
                    res.end();
                } catch (e) {}
            }
        });

    } catch (error) {
        if (fileResponse && fileResponse.body) {
            try {
                fileResponse.body.destroy();
            } catch (e) {}
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
            } catch (e) {}
        }
    }
});

module.exports = router;