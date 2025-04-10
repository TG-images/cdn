const express = require('express');
const router = express.Router();

// 保存文件夹信息到数据库
async function saveFolderToDatabase(db, folderInfo) {
    const { name, parent_id } = folderInfo;
    
    try {
        const result = await db.prepare(
            `INSERT INTO files (filename, is_folder, parent_id, created_at)
             VALUES (?, 1, ?, datetime('now', '+8 hours'))
             RETURNING id`
        ).bind(name, parent_id).first();
        
        return result.id;
    } catch (error) {
        console.error('保存文件夹错误:', error);
        throw error;
    }
}

// 获取文件夹列表
async function getFoldersFromDatabase(db, parentId = null) {
    try {
        let query = `SELECT * FROM files WHERE is_folder = 1`;
        let params = [];
        
        if (parentId !== null) {
            query += ` AND parent_id = ?`;
            params.push(parentId);
        } else {
            query += ` AND (parent_id IS NULL OR parent_id = 0)`;
        }
        
        const folders = await db.prepare(query).bind(...params).all();
        return folders.results;
    } catch (error) {
        console.error('获取文件夹列表错误:', error);
        throw error;
    }
}

// 创建文件夹
router.post('/', async (req, res) => {
    try {
        const { name, parent_id } = req.body;

        if (!name) {
            return res.status(400).json({
                error: '文件夹名称不能为空'
            });
        }

        // 将文件夹信息保存到数据库
        const folderInfo = {
            name: name,
            parent_id: parent_id || null
        };

        // 保存到 D1 数据库
        const folderId = await saveFolderToDatabase(req.db, folderInfo);
        
        // 格式化响应数据
        const responseData = {
            id: folderId,
            filename: name,
            is_folder: 1,
            parent_id: parent_id || null,
            created_at: new Date().toISOString()
        };

        res.json({
            success: true,
            folder: responseData
        });
    } catch (error) {
        res.status(500).json({
            error: '创建文件夹失败',
            message: error.message,
            stack: error.stack
        });
    }
});

// 获取文件夹列表
router.get('/', async (req, res) => {
    try {
        const parentId = req.query.parent_id || null;
        
        // 从 D1 数据库获取文件夹列表
        const folders = await getFoldersFromDatabase(req.db, parentId);
        
        res.json({
            success: true,
            folders: folders
        });
    } catch (error) {
        res.status(500).json({
            error: '获取文件夹列表失败',
            message: error.message,
            stack: error.stack
        });
    }
});

// 获取文件夹详情
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // 从 D1 数据库获取文件夹详情
        const folder = await req.db.prepare(
            `SELECT * FROM files WHERE id = ? AND is_folder = 1`
        ).bind(id).first();
        
        if (!folder) {
            return res.status(404).json({
                error: '文件夹不存在'
            });
        }

        res.json({
            success: true,
            folder: folder
        });
    } catch (error) {
        res.status(500).json({
            error: '获取文件夹详情失败',
            message: error.message,
            stack: error.stack
        });
    }
});

// 更新文件夹
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, parent_id } = req.body;

        if (!name) {
            return res.status(400).json({
                error: '文件夹名称不能为空'
            });
        }

        // 更新 D1 数据库中的文件夹信息
        await req.db.prepare(
            `UPDATE files SET filename = ?, parent_id = ? WHERE id = ?`
        ).bind(name, parent_id || null, id).run();
        
        // 获取更新后的文件夹
        const updatedFolder = await req.db.prepare(
            `SELECT * FROM files WHERE id = ?`
        ).bind(id).first();

        res.json({
            success: true,
            folder: updatedFolder
        });
    } catch (error) {
        res.status(500).json({
            error: '更新文件夹失败',
            message: error.message,
            stack: error.stack
        });
    }
});

// 删除文件夹
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // 检查文件夹是否存在
        const folder = await req.db.prepare(
            `SELECT * FROM files WHERE id = ? AND is_folder = 1`
        ).bind(id).first();
        
        if (!folder) {
            return res.status(404).json({
                error: '文件夹不存在'
            });
        }
        
        // 删除文件夹及其内容
        // 首先删除子文件和子文件夹
        await req.db.prepare(
            `DELETE FROM files WHERE parent_id = ?`
        ).bind(id).run();
        
        // 然后删除文件夹本身
        await req.db.prepare(
            `DELETE FROM files WHERE id = ?`
        ).bind(id).run();

        res.json({
            success: true,
            message: '文件夹删除成功'
        });
    } catch (error) {
        res.status(500).json({
            error: '删除文件夹失败',
            message: error.message,
            stack: error.stack
        });
    }
});

module.exports = router; 