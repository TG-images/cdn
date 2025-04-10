import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import { cors } from 'hono/cors';
import { createDB } from '../db';
import { files, users } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

// 创建Hono应用
const app = new Hono();

// 配置CORS
app.use('/*', cors());

// 配置JWT中间件
app.use('/*', async (c, next) => {
  // 跳过登录和注册路由的JWT验证
  if (c.req.path === '/api/auth/login' || c.req.path === '/api/auth/register') {
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: '请先登录' }, 401);
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, c.env.SESSION_SECRET);
    c.set('user', decoded);
    await next();
  } catch (error) {
    return c.json({ error: '无效的令牌' }, 401);
  }
});

// 登录路由
app.post('/api/auth/login', async (c) => {
  const { username, password } = await c.req.json();
  
  if (!username || !password) {
    return c.json({ error: '用户名和密码不能为空' }, 400);
  }

  const db = createDB(c.env.DB);
  
  try {
    // 查找用户
    const user = await db.select().from(users).where(eq(users.username, username)).get();
    if (!user) {
      return c.json({ error: '用户名或密码错误' }, 401);
    }

    // 验证密码
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return c.json({ error: '用户名或密码错误' }, 401);
    }

    // 生成JWT令牌
    const token = jwt.sign(
      { id: user.id, username: user.username },
      c.env.SESSION_SECRET,
      { expiresIn: '24h' }
    );

    return c.json({ 
      token,
      user: {
        id: user.id,
        username: user.username
      }
    });
  } catch (error) {
    console.error('登录错误:', error);
    return c.json({ error: '登录失败' }, 500);
  }
});

// 注册路由
app.post('/api/auth/register', async (c) => {
  const { username, password } = await c.req.json();
  
  if (!username || !password) {
    return c.json({ error: '用户名和密码不能为空' }, 400);
  }

  const db = createDB(c.env.DB);
  
  try {
    // 检查用户名是否已存在
    const existingUser = await db.select().from(users).where(eq(users.username, username)).get();
    if (existingUser) {
      return c.json({ error: '用户名已存在' }, 400);
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);

    // 创建新用户
    const [user] = await db.insert(users).values({
      username,
      password: hashedPassword
    }).returning();

    // 生成JWT令牌
    const token = jwt.sign(
      { id: user.id, username: user.username },
      c.env.SESSION_SECRET,
      { expiresIn: '24h' }
    );

    return c.json({ token, user: { id: user.id, username: user.username } });
  } catch (error) {
    console.error('注册错误:', error);
    return c.json({ error: '注册失败' }, 500);
  }
});

// 文件上传路由
app.post('/api/upload', async (c) => {
  const user = c.get('user');
  const formData = await c.req.formData();
  const file = formData.get('file');
  const parentId = formData.get('parentId');
  const caption = formData.get('caption');

  if (!file) {
    return c.json({ error: '没有文件被上传' }, 400);
  }

  const db = createDB(c.env.DB);

  try {
    // 上传到Telegram
    const form = new FormData();
    form.append('document', file);
    form.append('chat_id', c.env.CHAT_ID);
    if (caption) {
      form.append('caption', caption);
    }

    const response = await fetch(`https://api.telegram.org/bot${c.env.BOT_TOKEN}/sendDocument`, {
      method: 'POST',
      body: form
    });

    const result = await response.json();

    if (!result.ok) {
      console.error('Telegram API error:', result);
      return c.json({ error: '上传到Telegram失败' }, 500);
    }

    // 获取文件ID
    const fileId = result.result.document.file_id;
    const fileName = file.name;
    const fileSize = file.size;

    // 保存文件信息到数据库
    const [fileRecord] = await db.insert(files).values({
      name: fileName,
      size: fileSize,
      tgFileId: fileId,
      parentId: parentId ? parseInt(parentId) : null,
      isFolder: false,
      caption: caption || null,
      userId: user.id
    }).returning();

    return c.json({
      success: true,
      file: fileRecord
    });
  } catch (error) {
    console.error('文件上传错误:', error);
    return c.json({ error: '文件上传失败' }, 500);
  }
});

// 文件下载路由
app.get('/api/download/:id', async (c) => {
  const user = c.get('user');
  const fileId = c.req.param('id');

  const db = createDB(c.env.DB);

  try {
    // 获取文件信息
    const file = await db.select().from(files).where(eq(files.id, fileId)).get();
    
    if (!file) {
      return c.json({ error: '文件不存在' }, 404);
    }

    // 检查文件所有权
    if (file.userId !== user.id) {
      return c.json({ error: '没有权限访问此文件' }, 403);
    }

    // 获取Telegram文件路径
    const fileInfoResponse = await fetch(
      `https://api.telegram.org/bot${c.env.BOT_TOKEN}/getFile?file_id=${file.tgFileId}`
    );
    
    const fileInfo = await fileInfoResponse.json();
    
    if (!fileInfo.ok) {
      return c.json({ error: '无法获取文件信息' }, 500);
    }

    const filePath = fileInfo.result.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${c.env.BOT_TOKEN}/${filePath}`;

    // 重定向到Telegram文件URL
    return c.redirect(fileUrl);
  } catch (error) {
    console.error('文件下载错误:', error);
    return c.json({ error: '文件下载失败' }, 500);
  }
});

// 文件预览路由
app.get('/api/preview/:id', async (c) => {
  const user = c.get('user');
  const fileId = c.req.param('id');

  const db = createDB(c.env.DB);

  try {
    // 获取文件信息
    const file = await db.select().from(files).where(eq(files.id, fileId)).get();
    
    if (!file) {
      return c.json({ error: '文件不存在' }, 404);
    }

    // 检查文件所有权
    if (file.userId !== user.id) {
      return c.json({ error: '没有权限访问此文件' }, 403);
    }

    // 如果是文件夹，返回错误
    if (file.isFolder) {
      return c.json({ error: '无法预览文件夹' }, 400);
    }

    // 获取Telegram文件路径
    const fileInfoResponse = await fetch(
      `https://api.telegram.org/bot${c.env.BOT_TOKEN}/getFile?file_id=${file.tgFileId}`
    );
    
    const fileInfo = await fileInfoResponse.json();
    
    if (!fileInfo.ok) {
      return c.json({ error: '无法获取文件信息' }, 500);
    }

    const filePath = fileInfo.result.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${c.env.BOT_TOKEN}/${filePath}`;

    // 获取文件内容
    const fileResponse = await fetch(fileUrl);
    const contentType = fileResponse.headers.get('content-type') || 'application/octet-stream';

    // 如果是图片、PDF或文本文件，直接返回预览
    if (
      contentType.startsWith('image/') ||
      contentType === 'application/pdf' ||
      contentType.startsWith('text/')
    ) {
      return new Response(fileResponse.body, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': 'inline'
        }
      });
    }

    // 对于其他类型的文件，返回不支持预览的错误
    return c.json({ error: '不支持预览此类型的文件' }, 400);
  } catch (error) {
    console.error('文件预览错误:', error);
    return c.json({ error: '文件预览失败' }, 500);
  }
});

// 文件列表路由
app.get('/api/files', async (c) => {
  const user = c.get('user');
  const parentId = c.req.query('parentId');
  
  const db = createDB(c.env.DB);

  try {
    // 构建查询条件
    const conditions = [eq(files.userId, user.id)];
    if (parentId) {
      conditions.push(eq(files.parentId, parseInt(parentId)));
    } else {
      conditions.push(eq(files.parentId, null));
    }

    // 获取文件列表
    const fileList = await db.select()
      .from(files)
      .where(and(...conditions))
      .orderBy(files.createdAt);

    return c.json({
      success: true,
      files: fileList
    });
  } catch (error) {
    console.error('获取文件列表错误:', error);
    return c.json({ error: '获取文件列表失败' }, 500);
  }
});

// 文件删除路由
app.delete('/api/files/:id', async (c) => {
  const user = c.get('user');
  const fileId = c.req.param('id');

  const db = createDB(c.env.DB);

  try {
    // 获取文件信息
    const file = await db.select().from(files).where(eq(files.id, fileId)).get();
    
    if (!file) {
      return c.json({ error: '文件不存在' }, 404);
    }

    // 检查文件所有权
    if (file.userId !== user.id) {
      return c.json({ error: '没有权限删除此文件' }, 403);
    }

    // 如果是文件夹，递归删除所有子文件和子文件夹
    if (file.isFolder) {
      const deleteFolder = async (folderId) => {
        const children = await db.select().from(files).where(eq(files.parentId, folderId));
        for (const child of children) {
          if (child.isFolder) {
            await deleteFolder(child.id);
          }
          await db.delete(files).where(eq(files.id, child.id));
        }
      };
      await deleteFolder(fileId);
    }

    // 从数据库中删除文件记录
    await db.delete(files).where(eq(files.id, fileId));

    return c.json({
      success: true,
      message: '文件删除成功'
    });
  } catch (error) {
    console.error('文件删除错误:', error);
    return c.json({ error: '文件删除失败' }, 500);
  }
});

// 文件重命名路由
app.put('/api/files/:id', async (c) => {
  const user = c.get('user');
  const fileId = c.req.param('id');
  const { newName } = await c.req.json();

  if (!newName) {
    return c.json({ error: '新文件名不能为空' }, 400);
  }

  const db = createDB(c.env.DB);

  try {
    // 获取文件信息
    const file = await db.select().from(files).where(eq(files.id, fileId)).get();
    
    if (!file) {
      return c.json({ error: '文件不存在' }, 404);
    }

    // 检查文件所有权
    if (file.userId !== user.id) {
      return c.json({ error: '没有权限重命名此文件' }, 403);
    }

    // 检查同级目录下是否有同名文件
    const existingFile = await db.select()
      .from(files)
      .where(and(
        eq(files.parentId, file.parentId),
        eq(files.name, newName),
        eq(files.userId, user.id)
      ))
      .get();

    if (existingFile) {
      return c.json({ error: '同级目录下已存在同名文件' }, 400);
    }

    // 更新文件名
    const [updatedFile] = await db.update(files)
      .set({ name: newName })
      .where(eq(files.id, fileId))
      .returning();

    return c.json({
      success: true,
      file: updatedFile
    });
  } catch (error) {
    console.error('文件重命名错误:', error);
    return c.json({ error: '文件重命名失败' }, 500);
  }
});

// 创建文件夹路由
app.post('/api/files/folder', async (c) => {
  const user = c.get('user');
  const { name, parentId } = await c.req.json();

  if (!name) {
    return c.json({ error: '文件夹名称不能为空' }, 400);
  }

  const db = createDB(c.env.DB);

  try {
    // 检查同级目录下是否有同名文件夹
    const existingFolder = await db.select()
      .from(files)
      .where(and(
        eq(files.parentId, parentId || null),
        eq(files.name, name),
        eq(files.isFolder, true),
        eq(files.userId, user.id)
      ))
      .get();

    if (existingFolder) {
      return c.json({ error: '同级目录下已存在同名文件夹' }, 400);
    }

    // 创建新文件夹
    const [folder] = await db.insert(files).values({
      name,
      parentId: parentId || null,
      isFolder: true,
      userId: user.id
    }).returning();

    return c.json({
      success: true,
      folder
    });
  } catch (error) {
    console.error('创建文件夹错误:', error);
    return c.json({ error: '创建文件夹失败' }, 500);
  }
});

// 导出应用
export default app; 