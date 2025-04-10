import { getFileFromTelegram } from '../../../utils/telegram';

export default async function handler(req, res) {
  const { id } = req.params;
  const { original_name } = req.query;
  
  try {
    // 从环境变量获取Bot Token
    const BOT_TOKEN = process.env.BOT_TOKEN;
    if (!BOT_TOKEN) {
      return res.status(500).json({
        error: 'Configuration error',
        message: '服务器配置错误：BOT_TOKEN未配置'
      });
    }

    // 获取文件内容
    const fileBuffer = await getFileFromTelegram(id, BOT_TOKEN);

    // 根据文件名推断Content-Type
    let contentType = 'application/octet-stream';
    if (original_name) {
      const ext = original_name.toLowerCase().split('.').pop();
      const mimeTypes = {
        'pdf': 'application/pdf',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'mp4': 'video/mp4',
        'mp3': 'audio/mpeg',
        'wav': 'audio/wav',
        'doc': 'application/msword',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xls': 'application/vnd.ms-excel',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'ppt': 'application/vnd.ms-powerpoint',
        'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      };
      contentType = mimeTypes[ext] || contentType;
    }

    // 设置响应头
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${original_name || 'file'}"`); 

    // 返回文件内容
    return res.send(fileBuffer);

  } catch (error) {
    console.error('预览文件失败:', error);
    return res.status(500).json({
      error: 'Preview failed',
      message: '预览文件失败: ' + error.message
    });
  }
}