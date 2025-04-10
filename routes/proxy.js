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
        console.log('尝试获取文件ID，messageId:', messageId);
        
        // 首先尝试直接使用messageId作为file_id
        const response = await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${messageId}`
        );

        if (response.ok) {
            const data = await response.json();
            console.log('Telegram API 响应:', data);
            if (data.ok) {
                return messageId;
            }
        }

        // 如果直接使用失败，尝试获取消息内容
        const formattedChatId = CHAT_ID.startsWith('-100') ? CHAT_ID : `-100${CHAT_ID.replace(/^-/, '')}`;
        console.log('格式化后的 CHAT_ID:', formattedChatId);
        
        const msgResponse = await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/getMessage?chat_id=${formattedChatId}&message_id=${messageId}`
        );

        if (!msgResponse.ok) {
            console.error('获取消息失败:', msgResponse.status, msgResponse.statusText);
            throw new Error(`获取消息失败: ${msgResponse.statusText}`);
        }

        const data = await msgResponse.json();
        console.log('获取消息响应:', data);
        
        const message = data.result;
        if (!message) {
            throw new Error('消息不存在');
        }

        let fileId = null;
        if (message.document) {
            fileId = message.document.file_id;
        } else if (message.photo) {
            fileId = message.photo[message.photo.length - 1].file_id;
        } else if (message.video) {
            fileId = message.video.file_id;
        } else if (message.audio) {
            fileId = message.audio.file_id;
        } else if (message.voice) {
            fileId = message.voice.file_id;
        } else if (message.video_note) {
            fileId = message.video_note.file_id;
        }

        if (!fileId) {
            throw new Error('消息中未找到文件');
        }

        console.log('成功获取文件ID:', fileId);
        return fileId;
    } catch (error) {
        console.error('从消息获取文件ID失败:', error);
        throw error;
    }
}

// 处理m3u8文件
async function handleM3u8File(file, parentId, db) {
    try {
        // 获取同一文件夹下的所有切片文件
        const segmentFiles = await db.prepare(
            'SELECT * FROM files WHERE parent_id = ?'
        ).bind(parentId).all();
        
        // 获取m3u8文件内容
        const m3u8Content = await getFileFromTelegram(file.file_id);
        let m3u8Text = m3u8Content.toString('utf-8');
        
        // 替换所有切片文件的路径
        const segmentMap = new Map();
        segmentFiles.forEach(segmentFile => {
            if (segmentFile.filename.match(/\.(ts|webm|mp4|m4s|vtt|srt|ass)$/i)) {
                segmentMap.set(segmentFile.filename, segmentFile);
            }
        });
        
        // 匹配所有支持的切片文件类型
        const segmentPattern = /^(.*?\.(ts|webm|mp4|m4s|vtt|srt|ass))$/gm;
        m3u8Text = m3u8Text.replace(segmentPattern, (match, fileName) => {
            const trimmedName = fileName.trim();
            const segmentInfo = segmentMap.get(trimmedName);
            if (segmentInfo) {
                return `/proxy/${segmentInfo.id}`;
            }
            return match;
        });
        
        return m3u8Text;
    } catch (error) {
        console.error('处理m3u8文件错误:', error);
        throw error;
    }
}

// 从Telegram获取文件
async function getFileFromTelegram(fileId) {
    try {
        console.log('开始从Telegram获取文件，fileId:', fileId);
        
        if (!BOT_TOKEN) {
            throw new Error('BOT_TOKEN未配置');
        }

        // 获取文件路径
        const tgResponse = await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`
        );

        if (!tgResponse.ok) {
            console.error('Telegram API错误:', tgResponse.status, tgResponse.statusText);
            throw new Error(`Telegram API错误: ${tgResponse.statusText}`);
        }

        const tgData = await tgResponse.json();
        console.log('Telegram getFile响应:', tgData);
        
        if (!tgData.ok || !tgData.result.file_path) {
            throw new Error('无法从Telegram获取文件路径');
        }

        // 获取文件内容
        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${tgData.result.file_path}`;
        console.log('文件URL:', fileUrl);
        
        const fileResponse = await fetch(fileUrl);
        
        if (!fileResponse.ok) {
            console.error('文件下载失败:', fileResponse.status, fileResponse.statusText);
            throw new Error(`文件下载失败: ${fileResponse.statusText}`);
        }

        const buffer = await fileResponse.buffer();
        console.log('文件下载成功，大小:', buffer.length);
        return buffer;
    } catch (error) {
        console.error('从Telegram获取文件失败:', error);
        throw error;
    }
}

// 生成播放器 HTML
function generatePlayerHTML(fileId, originalName) {
    console.log('初始化播放器:', { fileId, originalName });

    const commonStyles = `
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            margin: 0; 
            background: #000; 
            width: 100vw;
            height: 100vh;
            overflow: hidden;
        }
        #videoContainer { 
            width: 100%;
            height: 100%;
            display: flex;
            justify-content: center;
            align-items: center;
        }
        #videoPlayer { 
            width: 100%;
            height: 100%;
            object-fit: contain;
        }
        .error {
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(255, 0, 0, 0.8);
            color: white;
            padding: 10px 20px;
            border-radius: 4px;
            z-index: 1000;
        }
    `;

    return `<!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8" />
        <title>${originalName || '视频播放器'}</title>
        <style>${commonStyles}</style>
        <script>
            // 调试代码：记录页面加载信息
            console.log("当前页面URL:", window.location.href);
            console.log("来源页面:", document.referrer || "无来源");
            
            // 监听资源加载错误
            window.addEventListener('error', function(e) {
                if (e.target.tagName === 'LINK' || e.target.tagName === 'SCRIPT') {
                    console.error('资源加载失败:', e.target.src || e.target.href);
                }
            }, true);
        </script>
    </head>
    <body>
        <div id="videoContainer">
            <video id="videoPlayer" controls preload="auto"></video>
        </div>
        <script>
        (async () => {
            const video = document.getElementById('videoPlayer');
            
            function showError(message) {
                console.error('错误:', message);
                const error = document.createElement('div');
                error.className = 'error';
                error.textContent = message;
                document.body.appendChild(error);
                setTimeout(() => error.remove(), 3000);
            }

            // 从localStorage读取上次播放位置
            const lastPosition = localStorage.getItem('video_position_${fileId}');
            if (lastPosition) {
                video.currentTime = parseFloat(lastPosition);
            }

            // 每秒保存播放位置
            setInterval(() => {
                if (!video.paused) {
                    localStorage.setItem('video_position_${fileId}', video.currentTime.toString());
                }
            }, 1000);

            // 在页面关闭时保存位置
            window.addEventListener('beforeunload', () => {
                localStorage.setItem('video_position_${fileId}', video.currentTime.toString());
            });

            try {
                console.log('使用原生播放器播放');
                video.src = \`/proxy/${fileId}\`;

                // 错误处理
                video.addEventListener('error', (e) => {
                    console.error('视频播放错误:', {
                        error: video.error,
                        code: video.error?.code,
                        message: video.error?.message,
                        event: e
                    });
                    showError('视频加载失败，请刷新重试');
                });

                video.addEventListener('loadedmetadata', () => {
                    console.log('视频元数据加载完成:', {
                        duration: video.duration,
                        videoWidth: video.videoWidth,
                        videoHeight: video.videoHeight
                    });
                });

                video.addEventListener('progress', () => {
                    if (video.buffered.length > 0) {
                        console.log('加载进度:', video.buffered.end(video.buffered.length - 1));
                    }
                });
            } catch (error) {
                console.error('初始化播放器失败:', error);
                showError('初始化播放器失败，请刷新重试');
            }
        })();
        </script>
    </body>
    </html>`;
}

// 代理路由处理
router.get('/:fileId', async (req, res) => {
    try {
        const { fileId } = req.params;
        const { original_name, disposition = 'attachment', player, info } = req.query;
        
        console.log('代理请求:', {
            fileId,
            original_name,
            disposition,
            player,
            info
        });

        // 处理静态资源请求
        if (req.path.startsWith('/proxy/css/') || req.path.startsWith('/proxy/js/')) {
            // 移除'/proxy/'前缀，直接使用相对路径
            return res.redirect(req.path.replace('/proxy/', '/'));
        }

        // 从数据库获取文件信息
        const db = req.app.get('db');
        const fileInfo = await db.prepare(
            'SELECT id, filename, mime_type, file_size, message_id, file_id, parent_id FROM files WHERE id = ?'
        ).bind(fileId).first();

        if (!fileInfo) {
            return res.status(404).json({ error: '文件不存在' });
        }

        // 如果是请求文件信息
        if (info === 'true') {
            return res.json({
                id: fileInfo.id,
                filename: fileInfo.filename,
                mime_type: fileInfo.mime_type,
                file_size: fileInfo.file_size,
                parent_id: fileInfo.parent_id
            });
        }

        // 获取文件内容
        const fileBuffer = await getFileFromTelegram(fileInfo.file_id);
        
        // 如果是播放器请求，返回播放器HTML
        if (player === '1') {
            // 检查文件的实际类型
            const fileExt = fileInfo.filename.toLowerCase().split('.').pop();
            
            // 默认使用原生播放器，只有ts文件使用HLS播放器
            let actualFileType = 'native';
            if (fileExt === 'ts') {
                actualFileType = 'hls';
            }
            
            console.log('文件类型检查:', { 
                filename: fileInfo.filename,
                extension: fileExt,
                detectedType: actualFileType
            });

            const playerHtml = generatePlayerHTML(fileId, original_name || fileInfo.filename);
            res.setHeader('Content-Type', 'text/html');
            res.setHeader('Cache-Control', 'no-cache');
            return res.send(playerHtml);
        }

        // 检查是否是 m3u8 文件
        const isM3u8 = fileInfo.filename.endsWith('.m3u8') || fileInfo.mime_type === 'application/vnd.apple.mpegurl';
        if (isM3u8) {
            try {
                console.log('[Proxy] 处理 m3u8 文件:', fileInfo);
                const m3u8Content = await handleM3u8File(fileInfo, fileInfo.parent_id, db);
                
                res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Cache-Control', 'no-cache');
                return res.send(m3u8Content);
            } catch (error) {
                console.error('[Proxy] 处理 m3u8 文件错误:', error);
                return res.status(500).json({
                    error: '处理 m3u8 文件失败',
                    details: error.message
                });
            }
        }

        // 处理 Range 请求
        const rangeHeader = req.headers.range;
        let status = 200;
        let headers = {
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=31536000',
        };

        if (rangeHeader) {
            console.log("[Proxy] 处理 Range 请求:", rangeHeader);
            const matches = rangeHeader.match(/bytes=(\d+)-(\d+)?/);
            if (matches) {
                const start = parseInt(matches[1]);
                const end = matches[2] ? parseInt(matches[2]) : fileInfo.file_size - 1;
                status = 206;
                headers['Content-Range'] = `bytes ${start}-${end}/${fileInfo.file_size}`;
                
                // 发送部分内容
                const partialBuffer = fileBuffer.slice(start, end + 1);
                res.status(status);
                Object.entries(headers).forEach(([key, value]) => {
                    res.setHeader(key, value);
                });
                return res.send(partialBuffer);
            }
        }

        // 设置正确的 Content-Type
        const fileExt = fileInfo.filename.split('.').pop().toLowerCase();
        switch (fileExt) {
            case 'ts':
                res.setHeader('Content-Type', 'video/mp2t');
                break;
            case 'webm':
                res.setHeader('Content-Type', 'video/webm');
                res.setHeader('Accept-Ranges', 'bytes');
                break;
            case 'm4s':
                res.setHeader('Content-Type', 'video/iso.segment');
                break;
            case 'vtt':
                res.setHeader('Content-Type', 'text/vtt');
                break;
            case 'srt':
                res.setHeader('Content-Type', 'application/x-subrip');
                break;
            case 'ass':
                res.setHeader('Content-Type', 'text/plain');
                break;
            default:
                res.setHeader('Content-Type', fileInfo.mime_type || 'application/octet-stream');
        }

        // 设置其他响应头
        Object.entries(headers).forEach(([key, value]) => {
            res.setHeader(key, value);
        });
        
        if (original_name) {
            const dispositionValue = disposition === 'inline' ? 'inline' : 'attachment';
            res.setHeader('Content-Disposition', `${dispositionValue}; filename*=UTF-8''${encodeURIComponent(original_name)}`);
        }

        // 发送文件内容
        res.status(status).send(fileBuffer);
    } catch (error) {
        console.error('代理请求处理失败:', error);
        res.status(500).json({ 
            error: '处理请求失败',
            message: error.message
        });
    }
});

module.exports = router;