export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/', '');
  
  // 密码哈希和验证辅助函数
  // 使用 Web Crypto API 实现密码哈希和验证
  async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    
    // 生成随机盐值
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
    
    // 结合密码和盐进行哈希
    const hashBuffer = await crypto.subtle.digest('SHA-256', new Uint8Array([...salt, ...data]));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    // 返回格式: 盐值$哈希值
    return `${saltHex}$${hashHex}`;
  }
  
  async function verifyPassword(password, storedHash) {
    try {
      // 如果是固定比较（仅用于初始管理员用户）
      if (storedHash === '$2a$10$mQi9T0wRzPNT9mf7eQrVZ.VYUvj.giH0vyjSLsJa.RXbjUVK5sOHy' && password === 'admin123') {
        return true;
      }
      
      // 处理标准哈希格式
      const [saltHex, hashHex] = storedHash.split('$');
      if (!saltHex || !hashHex) {
        return false;
      }
      
      const encoder = new TextEncoder();
      const data = encoder.encode(password);
      
      // 将盐值从十六进制转换为字节数组
      const salt = new Uint8Array(saltHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
      
      // 结合密码和盐进行哈希
      const hashBuffer = await crypto.subtle.digest('SHA-256', new Uint8Array([...salt, ...data]));
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const computedHashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      
      // 比较计算的哈希与存储的哈希
      return computedHashHex === hashHex;
    } catch (error) {
      console.error('密码验证错误:', error);
      return false;
    }
  }
  
  // 记录环境变量和请求信息
  console.log('接收到请求:', {
    path: path,
    method: request.method,
    url: request.url,
    hasDB: !!env.DB
  });
  
  // 检查数据库连接
  try {
    if (env.DB) {
      const dbTest = await env.DB.prepare("SELECT 1 as test").first();
      console.log('数据库连接测试:', dbTest);
    } else {
      console.error('未找到数据库连接! 请确保在Cloudflare Pages中正确绑定D1数据库到"DB"变量');
    }
  } catch (dbError) {
    console.error('数据库连接测试失败:', dbError);
  }
  
  // 添加 CORS 头
  const corsHeaders = {
    'Access-Control-Allow-Origin': 'https://cdnceshi1.0163.eu.org',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Cookie'
  };

  // 处理 OPTIONS 请求
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }

  // 检查是否是登录相关的API请求
  const isAuthRequest = path.startsWith('auth/') || path === 'login' || path === 'register';
  
  try {
    // 如果是登录请求，直接处理
    if (path === 'login' && request.method === 'POST') {
      const data = await request.json();
      const { username, password } = data;
      
      // 从数据库验证用户名和密码
      const db = env.DB;
      
      if (!db) {
        throw new Error('D1 数据库未正确绑定，env.DB 为空');
      }
      
      // 获取用户信息
      const user = await db.prepare(
        `SELECT id, username, password_hash FROM users WHERE username = ?`
      ).bind(username).first();
      
      if (!user) {
        return new Response(JSON.stringify({ 
          error: '用户名或密码错误',
          loggedIn: false
        }), {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
      
      // 验证密码
      // 使用安全的方式比较密码
      const passwordMatches = await verifyPassword(password, user.password_hash);
      
      if (!passwordMatches) {
        return new Response(JSON.stringify({ 
          error: '用户名或密码错误',
          loggedIn: false
        }), {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
      
      // 更新最后登录时间
      await db.prepare(
        `UPDATE users SET last_login = datetime('now', '+8 hours') WHERE id = ?`
      ).bind(user.id).run();
      
      // 创建会话
      const session = {
        userId: user.id,
        username: user.username,
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      };
      
      // 设置Cookie，确保SameSite和Secure属性正确
      const cookieValue = `session=${JSON.stringify(session)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`;
      
      return new Response(JSON.stringify({ 
        success: true, 
        user: { id: user.id, username: user.username } 
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': cookieValue,
          ...corsHeaders
        }
      });
    }
    
    // 检查会话状态
    if (path === 'auth/status') {
      const cookie = request.headers.get('Cookie');
      if (!cookie) {
        return new Response(JSON.stringify({ loggedIn: false }), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
      
      const sessionMatch = cookie.match(/session=([^;]+)/);
      if (!sessionMatch) {
        return new Response(JSON.stringify({ loggedIn: false }), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
      
      try {
        const session = JSON.parse(decodeURIComponent(sessionMatch[1]));
        if (new Date(session.expires) < new Date()) {
          return new Response(JSON.stringify({ loggedIn: false }), {
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        return new Response(JSON.stringify({ 
          loggedIn: true,
          user: { id: session.userId, username: session.username }
        }), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } catch (e) {
        return new Response(JSON.stringify({ loggedIn: false }), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }
    
    // 处理退出登录请求
    if (path === 'auth/logout' && request.method === 'POST') {
      // 清除会话Cookie
      return new Response(JSON.stringify({ success: true }), {
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:01 GMT',
          ...corsHeaders
        }
      });
    }
    
    // 处理修改密码请求
    if (path === 'auth/change-password' && request.method === 'POST') {
      try {
        const data = await request.json();
        const { currentPassword, newPassword } = data;
        
        // 检查Cookie中的会话信息
        const cookie = request.headers.get('Cookie');
        if (!cookie) {
          return new Response(JSON.stringify({ 
            error: '未登录'
          }), {
            status: 401,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // 解析会话
        const sessionMatch = cookie.match(/session=([^;]+)/);
        if (!sessionMatch) {
          return new Response(JSON.stringify({ 
            error: '会话无效'
          }), {
            status: 401,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // 获取会话信息
        const session = JSON.parse(decodeURIComponent(sessionMatch[1]));
        const userId = session.userId;
        
        if (!userId) {
          return new Response(JSON.stringify({ 
            error: '会话无效'
          }), {
            status: 401,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // 获取数据库
        const db = env.DB;
        
        if (!db) {
          throw new Error('D1 数据库未正确绑定，env.DB 为空');
        }
        
        // 获取当前用户
        const user = await db.prepare(
          `SELECT id, password_hash FROM users WHERE id = ?`
        ).bind(userId).first();
        
        if (!user) {
          return new Response(JSON.stringify({ 
            error: '用户不存在'
          }), {
            status: 404,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // 验证当前密码是否正确
        // 使用安全的密码验证函数
        const passwordMatches = await verifyPassword(currentPassword, user.password_hash);
        
        if (!passwordMatches) {
          return new Response(JSON.stringify({ 
            error: '当前密码不正确'
          }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // 新密码的哈希值（实际应使用bcrypt等生成）
        // 这里仅作示例，实际应用中应该使用bcrypt库生成哈希
        const newPasswordHash = await hashPassword(newPassword);
        
        // 更新用户密码
        await db.prepare(
          `UPDATE users SET password_hash = ? WHERE id = ?`
        ).bind(newPasswordHash, userId).run();
        
        return new Response(JSON.stringify({ 
          success: true,
          message: '密码已修改'
        }), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          error: '处理修改密码请求失败',
          message: error.message
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }
    
    // 验证会话
    const cookie = request.headers.get('Cookie');
    let isAuthenticated = false;
    let session = null;
    
    if (cookie) {
      const sessionMatch = cookie.match(/session=([^;]+)/);
      if (sessionMatch) {
        try {
          session = JSON.parse(decodeURIComponent(sessionMatch[1]));
          if (new Date(session.expires) > new Date()) {
            isAuthenticated = true;
          }
        } catch (e) {
          console.error('会话解析错误:', e);
        }
      }
    }
    
    // 如果不是认证请求且未登录，返回401
    if (!isAuthRequest && !isAuthenticated) {
      return new Response(JSON.stringify({ 
        error: '用户未登录',
        redirect: '/login.html'
      }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }

    // 验证环境变量
    function validateEnvVariables() {
      if (!env.BOT_TOKEN || env.BOT_TOKEN === 'your_bot_token_here') {
        throw new Error('Invalid BOT_TOKEN in environment variables');
      }
      if (!env.CHAT_ID || env.CHAT_ID === 'your_chat_id_here') {
        throw new Error('Invalid CHAT_ID in environment variables');
      }
    }

    // =================== 文件上传处理 ===================
    if (path === 'upload' && request.method === 'POST') {
      try {
        validateEnvVariables();
        
        // 处理文件上传请求
        const formData = await request.formData();
        
        if (!formData.has('file')) {
          return new Response(JSON.stringify({ 
            error: 'No file uploaded'
          }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        const file = formData.get('file');
        const parent_id = formData.get('parent_id') || null;
        
        // 上传到 Telegram
        const fileBuffer = await file.arrayBuffer();
        const fileName = file.name;
        
        // 创建FormData用于Telegram API
        const telegramForm = new FormData();
        const fileBlob = new Blob([fileBuffer], { type: file.type });
        telegramForm.append('document', fileBlob, fileName);
        telegramForm.append('chat_id', env.CHAT_ID);
        telegramForm.append('caption', fileName);
        
        // 发送到Telegram
        const telegramResponse = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendDocument`, {
          method: 'POST',
          body: telegramForm
        });
        
        if (!telegramResponse.ok) {
          const telegramError = await telegramResponse.json();
          throw new Error(telegramError.description || 'Failed to upload to Telegram');
        }
        
        const telegramResult = await telegramResponse.json();
        
        if (!telegramResult.ok) {
          throw new Error(telegramResult.description || 'Telegram API returned error');
        }
        
        // 获取消息ID
        const messageId = telegramResult.result.message_id;
        const tg_file_id = `${env.CHAT_ID}:${messageId}`;
        
        // 将文件信息保存到数据库
        const db = env.DB;
        
        if (!db) {
          throw new Error('D1 数据库未正确绑定，env.DB 为空');
        }
        
        // 获取父文件夹ID
        const parentId = formData.get('parent_id') || null;
        
        // 把文件信息保存到数据库
        const fileSize = file.size;
        
        console.log('File details:', {
          name: file.name,
          size: fileSize,
          type: file.type
        });
        
        // 插入文件记录
        const result = await db.prepare(
          `INSERT INTO files (filename, file_id, message_id, parent_id, created_at, is_folder, file_size, mime_type)
           VALUES (?, ?, ?, ?, datetime('now', '+8 hours'), 0, ?, ?)
           RETURNING id`
        ).bind(file.name, tg_file_id, messageId.toString(), parentId, fileSize, file.type).run();
        
        // 获取新文件的ID
        let fileId;
        if (result.meta && result.meta.last_row_id) {
          fileId = result.meta.last_row_id;
        } else if (result.results && result.results.length > 0) {
          fileId = result.results[0].id;
        } else {
          // 直接查询最后插入的ID
          const lastId = await db.prepare("SELECT last_insert_rowid() as id").first();
          fileId = lastId.id;
        }
        
        // 格式化响应数据
        const responseData = {
          id: fileId,
          filename: file.name,
          file_id: tg_file_id,
          message_id: messageId.toString(),
          parent_id: parentId,
          file_size: fileSize,
          is_folder: 0,
          mime_type: file.type,
          created_at: new Date().toISOString()
        };
        
        return new Response(JSON.stringify({
          success: true,
          file: responseData
        }), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } catch (error) {
        console.log('文件上传错误:', {
          message: error.message,
          stack: error.stack,
          name: error.name,
          cause: error.cause
        });
        return new Response(JSON.stringify({
          error: 'Upload failed',
          message: error.message,
          stack: error.stack,
          details: '请确保在Cloudflare Pages中正确绑定D1数据库到"DB"变量，并设置了正确的BOT_TOKEN和CHAT_ID'
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }
    
    // =================== 文件夹处理 ===================
    // 创建文件夹
    if (path === 'folders' && request.method === 'POST') {
      try {
        const requestData = await request.json();
        const { name, parent_id } = requestData;
        
        if (!name) {
          return new Response(JSON.stringify({
            error: '文件夹名称不能为空'
          }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // 获取D1数据库
        const db = env.DB;
        
        if (!db) {
          throw new Error('D1 数据库未正确绑定，env.DB 为空');
        }
        
        // 插入文件夹记录
        const result = await db.prepare(
          `INSERT INTO files (filename, is_folder, parent_id, created_at, file_size)
           VALUES (?, 1, ?, datetime('now', '+8 hours'), 0)
           RETURNING id`
        ).bind(name, parent_id || null).run();
        
        // 获取新创建的文件夹ID
        let folderId;
        if (result.meta && result.meta.last_row_id) {
          folderId = result.meta.last_row_id;
        } else if (result.results && result.results.length > 0) {
          folderId = result.results[0].id;
        } else {
          // 直接查询最后插入的ID
          const lastId = await db.prepare("SELECT last_insert_rowid() as id").first();
          folderId = lastId.id;
        }
        
        // 格式化响应数据
        const responseData = {
          id: folderId,
          filename: name,
          name: name,
          file_size: 0,
          size: 0,
          is_folder: 1,
          parent_id: parent_id || null,
          created_at: new Date().toISOString()
        };
        
        return new Response(JSON.stringify({
          success: true,
          folder: responseData
        }), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } catch (error) {
        console.error('创建文件夹错误:', error);
        return new Response(JSON.stringify({
          error: '创建文件夹失败',
          message: error.message,
          stack: error.stack
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }
    
    // 获取文件夹列表
    if (path === 'folders' && request.method === 'GET') {
      try {
        const url = new URL(request.url);
        const parentId = url.searchParams.get('parent_id') || null;
        
        // 获取D1数据库
        const db = env.DB;
        
        if (!db) {
          throw new Error('D1 数据库未正确绑定，env.DB 为空');
        }
        
        // 查询文件夹
        let query = `SELECT * FROM files WHERE is_folder = 1`;
        let params = [];
        
        if (parentId !== null) {
          query += ` AND parent_id = ?`;
          params.push(parentId);
        } else {
          query += ` AND (parent_id IS NULL OR parent_id = 0)`;
        }
        
        const result = await db.prepare(query).bind(...params).all();
        
        return new Response(JSON.stringify({
          success: true,
          folders: result.results
        }), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } catch (error) {
        console.error('获取文件夹列表错误:', error);
        return new Response(JSON.stringify({
          error: '获取文件夹列表失败',
          message: error.message,
          stack: error.stack
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }

    // 获取文件列表
    if (path === 'files' && request.method === 'GET') {
      try {
        const url = new URL(request.url);
        const parentId = url.searchParams.get('parent_id') || null;
        const allFiles = url.searchParams.get('all') === 'true';
        
        console.log('获取文件列表:', {
          parentId: parentId,
          allFiles: allFiles,
          hasDB: !!env.DB
        });
        
        // 获取D1数据库
        const db = env.DB;
        
        if (!db) {
          throw new Error('D1 数据库未正确绑定，env.DB 为空');
        }
        
        // 优化查询：提示使用索引，简化查询
        // 查询文件和文件夹
        let query = `SELECT id, filename, file_id, message_id, parent_id, is_folder, file_size, created_at, mime_type FROM files`;
        let params = [];
        
        // 如果不是获取所有文件，则按照父目录筛选
        if (!allFiles) {
          if (parentId !== null) {
            query += ` WHERE parent_id = ?`;
            params.push(parentId);
          } else {
            query += ` WHERE parent_id IS NULL OR parent_id = 0`;
          }
        }
        
        // 优化排序：提示使用索引
        query += ` ORDER BY is_folder DESC, created_at DESC LIMIT 500`;
        
        const stmt = db.prepare(query);
        console.log('执行优化查询:', {
          query: query,
          params: params
        });
        
        const result = await stmt.bind(...params).all();
        
        console.log('查询结果:', {
          count: result.results ? result.results.length : 0
        });
        
        // 简化处理：直接返回增强的结果
        const enhancedResults = result.results?.map(file => ({
          ...file,
          size: parseInt(file.file_size || 0, 10),
          name: file.filename
        })) || [];
        
        return new Response(JSON.stringify(enhancedResults), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } catch (error) {
        console.error('获取文件列表错误:', error);
        return new Response(JSON.stringify({
          error: '获取文件列表失败',
          message: error.message,
          stack: error.stack
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }

    // 文件移动
    if (path.match(/^files\/(\d+)\/move$/) && request.method === 'PUT') {
      try {
        const fileId = path.match(/^files\/(\d+)\/move$/)[1];
        const requestData = await request.json();
        const newParentId = requestData.newParentId;
        
        console.log('移动文件:', {
          fileId: fileId,
          newParentId: newParentId
        });
        
        // 获取D1数据库
        const db = env.DB;
        
        if (!db) {
          throw new Error('D1 数据库未正确绑定，env.DB 为空');
        }
        
        // 检查文件是否存在
        const file = await db.prepare(
          `SELECT id, is_folder FROM files WHERE id = ?`
        ).bind(fileId).first();
        
        if (!file) {
          return new Response(JSON.stringify({
            error: '文件不存在'
          }), {
            status: 404,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // 如果newParentId不为null，检查目标文件夹是否存在
        if (newParentId !== null) {
          const targetFolder = await db.prepare(
            `SELECT id, is_folder FROM files WHERE id = ? AND is_folder = 1`
          ).bind(newParentId).first();
          
          if (!targetFolder) {
            return new Response(JSON.stringify({
              error: '目标文件夹不存在'
            }), {
              status: 404,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
              }
            });
          }
          
          // 检查是否存在循环引用（文件夹不能移动到自己的子文件夹中）
          if (file.is_folder) {
            console.log('检查循环引用:', {
              folderId: fileId,
              targetId: newParentId
            });
            
            // 防止自己移动到自己
            if (fileId === newParentId) {
              return new Response(JSON.stringify({
                error: '不能将文件夹移动到自身'
              }), {
                status: 400,
                headers: {
                  'Content-Type': 'application/json',
                  ...corsHeaders
                }
              });
            }
            
            // 递归检查是否是子文件夹
            const isSubfolderResult = await isSubFolder(db, fileId, newParentId);
            if (isSubfolderResult) {
              return new Response(JSON.stringify({
                error: '不能将文件夹移动到其子文件夹中'
              }), {
                status: 400,
                headers: {
                  'Content-Type': 'application/json',
                  ...corsHeaders
                }
              });
            }
          }
        }
        
        // 移动文件（更新parent_id）
        await db.prepare(
          `UPDATE files SET parent_id = ? WHERE id = ?`
        ).bind(newParentId, fileId).run();
        
        return new Response(JSON.stringify({
          success: true,
          message: '文件移动成功'
        }), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } catch (error) {
        console.error('移动文件错误:', error);
        return new Response(JSON.stringify({
          error: '移动文件失败',
          message: error.message,
          stack: error.stack
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }
    
    // 辅助函数：检查是否是子文件夹
    async function isSubFolder(db, folderId, targetId) {
      // 如果folderId等于targetId，则folderId是targetId的子文件夹
      if (folderId === targetId) {
        return true;
      }
      
      // 获取targetId的parent_id
      const targetFolder = await db.prepare(
        `SELECT parent_id FROM files WHERE id = ?`
      ).bind(targetId).first();
      
      // 如果targetFolder没有parent_id，则folderId不是targetId的子文件夹
      if (!targetFolder || targetFolder.parent_id === null) {
        return false;
      }
      
      // 如果targetFolder的parent_id等于folderId，则targetId是folderId的子文件夹
      if (targetFolder.parent_id.toString() === folderId.toString()) {
        return true;
      }
      
      // 递归检查targetFolder的parent_id
      return await isSubFolder(db, folderId, targetFolder.parent_id);
    }

    // 文件重命名
    if (path.match(/^files\/(\d+)\/rename$/) && request.method === 'PUT') {
      try {
        const fileId = path.match(/^files\/(\d+)\/rename$/)[1];
        const requestData = await request.json();
        const newName = requestData.newName;
        
        console.log('重命名文件:', {
          fileId: fileId,
          newName: newName
        });
        
        // 获取D1数据库
        const db = env.DB;
        
        if (!db) {
          throw new Error('D1 数据库未正确绑定，env.DB 为空');
        }
        
        // 检查文件是否存在
        const file = await db.prepare(
          `SELECT id FROM files WHERE id = ?`
        ).bind(fileId).first();
        
        if (!file) {
          return new Response(JSON.stringify({
            error: '文件不存在'
          }), {
            status: 404,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // 重命名文件
        await db.prepare(
          `UPDATE files SET filename = ? WHERE id = ?`
        ).bind(newName, fileId).run();
        
        return new Response(JSON.stringify({
          success: true,
          message: '文件重命名成功'
        }), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } catch (error) {
        console.error('重命名文件错误:', error);
        return new Response(JSON.stringify({
          error: '重命名文件失败',
          message: error.message,
          stack: error.stack
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }

    // 文件删除
    if (path.match(/^files\/(\d+)$/) && request.method === 'DELETE') {
      try {
        const fileId = path.match(/^files\/(\d+)$/)[1];
        
        console.log('删除文件:', {
          fileId: fileId
        });
        
        // 获取D1数据库
        const db = env.DB;
        
        if (!db) {
          throw new Error('D1 数据库未正确绑定，env.DB 为空');
        }
        
        // 检查文件是否存在
        const file = await db.prepare(
          `SELECT id, is_folder FROM files WHERE id = ?`
        ).bind(fileId).first();
        
        if (!file) {
          return new Response(JSON.stringify({
            error: '文件不存在'
          }), {
            status: 404,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // 如果是文件夹，递归删除其中的所有文件和子文件夹
        if (file.is_folder) {
          // 递归删除子文件和子文件夹
          await deleteFolder(db, fileId);
        }
        
        // 删除文件本身
        await db.prepare(
          `DELETE FROM files WHERE id = ?`
        ).bind(fileId).run();
        
        return new Response(JSON.stringify({
          success: true,
          message: '文件删除成功'
        }), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } catch (error) {
        console.error('删除文件错误:', error);
        return new Response(JSON.stringify({
          error: '删除文件失败',
          message: error.message,
          stack: error.stack
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }
    
    // 辅助函数：递归删除文件夹
    async function deleteFolder(db, folderId) {
      // 获取文件夹中的子文件
      const files = await db.prepare(
        `SELECT id, is_folder FROM files WHERE parent_id = ?`
      ).bind(folderId).all();
      
      // 递归删除子文件夹
      for (const file of files.results || []) {
        if (file.is_folder) {
          await deleteFolder(db, file.id);
        }
      }
      
      // 删除文件夹中的所有文件
      await db.prepare(
        `DELETE FROM files WHERE parent_id = ?`
      ).bind(folderId).run();
    }

    // 获取文件夹大小
    if (path.match(/^folders\/(\d+)\/size$/) && request.method === 'GET') {
      try {
        const folderId = path.match(/^folders\/(\d+)\/size$/)[1];
        
        console.log('计算文件夹大小:', {
          folderId: folderId
        });
        
        // 获取D1数据库
        const db = env.DB;
        
        if (!db) {
          throw new Error('D1 数据库未正确绑定，env.DB 为空');
        }
        
        // 改进的递归SQL查询，只计算文件大小，不包括文件夹本身的大小
        const result = await db.prepare(`
          WITH RECURSIVE
          subfolder(id) AS (
            SELECT id FROM files WHERE id = ?
            UNION ALL
            SELECT f.id FROM files f, subfolder sf
            WHERE f.parent_id = sf.id
          )
          SELECT SUM(COALESCE(file_size, 0)) as total_size
          FROM files
          WHERE parent_id IN subfolder AND is_folder = 0
        `).bind(folderId).first();
        
        const totalSize = result.total_size || 0;
        
        console.log(`文件夹 ${folderId} 计算得到的大小:`, totalSize);
        
        // 不更新文件夹本身的大小，避免累加问题
        // 只返回计算结果
        return new Response(JSON.stringify({ 
          size: totalSize
        }), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } catch (error) {
        console.error('计算文件夹大小错误:', error);
        return new Response(JSON.stringify({
          error: '计算文件夹大小失败',
          message: error.message,
          stack: error.stack
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }

    // 如果不是特殊处理的路由，转发到原始API
    // 使用SITE_URL环境变量构建API_URL
    const apiUrl = `https://${env.SITE_URL}`;
    
    // 构建请求头
    const headers = {
      'Content-Type': request.headers.get('Content-Type') || 'application/json',
      'Accept': 'application/json',
      'Origin': request.headers.get('Origin') || apiUrl,
      'Referer': request.headers.get('Referer') || apiUrl,
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': request.headers.get('User-Agent') || 'Mozilla/5.0',
      'Accept-Language': request.headers.get('Accept-Language') || 'zh-CN,zh;q=0.9',
      'Accept-Encoding': request.headers.get('Accept-Encoding') || 'gzip, deflate, br'
    };
    
    // 如果有Cookie，添加到请求头
    if (cookie) {
      headers['Cookie'] = cookie;
    }
    
    // 构建目标URL
    let targetUrl = `${apiUrl}${url.pathname}${url.search}`;
    
    // 获取请求体
    let body = null;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      if (request.headers.get('Content-Type')?.includes('multipart/form-data')) {
        try {
          body = await request.formData();
        } catch (error) {
          console.error('处理formData错误:', error);
          return new Response(JSON.stringify({
            error: '处理请求失败',
            details: error.message
          }), {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
      } else {
        body = await request.text();
      }
    }
    
    // 记录请求信息
    console.log('转发请求:', {
      method: request.method,
      url: targetUrl,
      headers: Object.fromEntries(request.headers),
      hasBody: !!body
    });
    
    // 转发请求
    let response;
    try {
      response = await fetch(targetUrl, {
        method: request.method,
        headers: headers,
        credentials: 'include',
        body: body
      });
      
      // 记录响应信息
      console.log('收到响应:', {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries([...response.headers])
      });
    } catch (error) {
      console.error('请求转发错误:', error);
      return new Response(JSON.stringify({
        error: '转发请求失败',
        details: error.message,
        url: targetUrl
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    
    // 获取响应内容
    const responseText = await response.text();
    
    // 记录响应内容
    console.log('响应内容:', responseText);
    
    // 尝试解析JSON
    try {
      const jsonData = JSON.parse(responseText);
      
      // 创建响应对象
      return new Response(JSON.stringify(jsonData), {
        status: response.status,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    } catch (e) {
      console.error('API响应解析错误:', e);
      return new Response(JSON.stringify({ 
        error: '服务器返回了非JSON格式的数据',
        details: responseText,
        status: response.status,
        statusText: response.statusText
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
  } catch (error) {
    console.error('API请求处理错误:', error);
    return new Response(JSON.stringify({ 
      error: 'API请求处理错误',
      details: error.message,
      stack: error.stack
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
} 