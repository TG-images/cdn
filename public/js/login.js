// 显示提示信息
function showToast(message, type = 'success') {
    Toastify({
        text: message,
        duration: 3000,
        gravity: "top",
        position: 'right',
        style: {
            background: type === 'success' ? '#4caf50' : '#f44336'
        }
    }).showToast();
}

// 处理表单提交
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    
    // 禁用按钮防止重复提交
    const loginBtn = document.getElementById('loginBtn');
    loginBtn.disabled = true;
    loginBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> 登录中...';
    
    try {
        console.log('正在发送登录请求...');
        const requestBody = {
            username,
            password
        };
        
        console.log('请求体:', JSON.stringify(requestBody));
        
        // 使用相对路径，避免跨域问题
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'Origin': window.location.origin,
                'Referer': window.location.href
            },
            credentials: 'include',
            mode: 'cors',
            body: JSON.stringify(requestBody)
        });
        
        console.log('登录响应状态:', response.status);
        console.log('登录响应头:', JSON.stringify(Object.fromEntries([...response.headers])));
        
        // 检查响应状态
        if (response.status === 401 || response.status === 403) {
            const errorData = await response.json().catch(() => ({}));
            console.error('登录错误:', errorData);
            showToast(errorData.message || '用户名或密码错误', 'error');
            return;
        }
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('登录响应:', data);
        
        if (data.success) {
            showToast('登录成功，正在跳转...');
            // 等待会话完全建立
            await new Promise(resolve => setTimeout(resolve, 1000));
            // 跳转到首页
            window.location.href = '/index.html';
        } else {
            showToast(data.error || '登录失败，请检查用户名和密码', 'error');
        }
    } catch (error) {
        console.error('Login error:', error);
        showToast('登录失败，请稍后重试', 'error');
    } finally {
        // 恢复按钮状态
        loginBtn.disabled = false;
        loginBtn.innerHTML = '登录';
    }
}); 