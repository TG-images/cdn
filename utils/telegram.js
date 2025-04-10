const fetch = require('node-fetch');

/**
 * 从Telegram获取文件内容
 * @param {string} fileId - Telegram文件ID
 * @param {string} botToken - Telegram Bot Token
 * @returns {Promise<Buffer>} - 文件内容
 */
exports.getFileFromTelegram = async function(fileId, botToken) {
  try {
    // 获取文件路径
    const tgResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`,
      { timeout: 10000 }
    );

    if (!tgResponse.ok) {
      const errorData = await tgResponse.json().catch(() => ({}));
      throw new Error(`Telegram API错误: ${errorData.description || tgResponse.statusText}`);
    }

    const tgData = await tgResponse.json();
    
    if (!tgData.ok || !tgData.result.file_path) {
      throw new Error('无法从Telegram获取文件路径');
    }

    // 获取文件内容
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${tgData.result.file_path}`;
    const fileResponse = await fetch(fileUrl);
    
    if (!fileResponse.ok) {
      throw new Error(`文件下载失败: ${fileResponse.status} ${fileResponse.statusText}`);
    }

    return await fileResponse.buffer();
  } catch (error) {
    console.error('从Telegram获取文件失败:', error);
    throw error;
  }
};