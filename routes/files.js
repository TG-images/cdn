const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

// 获取单个文件信息
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // 从数据库获取文件信息
        const file = await req.db.prepare(
            'SELECT * FROM files WHERE id = ?'
        ).bind(id).first();
        
        if (!file) {
            return res.status(404).json({
                error: '文件不存在',
                message: '找不到指定ID的文件'
            });
        }
        
        res.json({
            success: true,
            file: file
        });
    } catch (error) {
        console.error('获取文件信息失败:', error);
        res.status(500).json({
            error: '获取文件信息失败',
            message: error.message
        });
    }
});

// 文件下载路由
router.get('/:id/download', async (req, res) => {
    try {
        const { id } = req.params;
        
        // 从数据库获取文件信息
        const file = await req.db.prepare(
            'SELECT * FROM files WHERE id = ?'
        ).bind(id).first();
        
        if (!file) {
            return res.status(404).json({
                error: '文件不存在',
                message: '找不到指定ID的文件'
            });
        }
        
        // 检查环境变量
        const BOT_TOKEN = process.env.BOT_TOKEN;
        if (!BOT_TOKEN) {
            return res.status(500).json({
                error: '服务器配置错误',
                message: '无法访问 Bot Token'
            });
        }
        
        // 获取文件下载链接
        const tgResponse = await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${file.file_id}`
        );
        
        if (!tgResponse.ok) {
            return res.status(502).json({
                error: 'Telegram API错误',
                message: '无法从Telegram获取文件'
            });
        }
        
        const tgData = await tgResponse.json();
        if (!tgData.ok || !tgData.result.file_path) {
            return res.status(502).json({
                error: 'Telegram API错误',
                message: '无法从Telegram获取文件路径'
            });
        }
        
        // 获取文件内容
        const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${tgData.result.file_path}`;
        const fileResponse = await fetch(downloadUrl);
        
        if (!fileResponse.ok) {
            return res.status(502).json({
                error: '下载失败',
                message: '文件下载失败'
            });
        }
        
        // 设置响应头
        res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename || file.name)}"`);
        
        // 流式传输文件内容
        fileResponse.body.pipe(res);
    } catch (error) {
        console.error('下载文件失败:', error);
        res.status(500).json({
            error: '下载文件失败',
            message: error.message
        });
    }
});

module.exports = router; 