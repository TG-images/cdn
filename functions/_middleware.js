import { Hono } from 'hono';
import { jwt } from 'hono/jwt';
import { cors } from 'hono/cors';

// 创建中间件应用
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

// 导出中间件
export default app; 