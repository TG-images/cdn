// 显示提示信息
function showToast(message, type = 'success') {
    Toastify({
        text: message,
        duration: 3000,
        gravity: "top",
        position: 'right',
        backgroundColor: type === 'success' ? '#4caf50' : '#f44336'
    }).showToast();
}

// 处理表单提交
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    
    // 获取reCAPTCHA响应
    let recaptchaToken = '';
    const recaptchaResponse = grecaptcha && grecaptcha.getResponse();
    
    if (recaptchaResponse) {
        recaptchaToken = recaptchaResponse;
    }
    
    // 检查是否需要验证reCAPTCHA
    const siteKey = document.querySelector('.g-recaptcha').getAttribute('data-sitekey');
    if (siteKey && siteKey !== 'YOUR_RECAPTCHA_SITE_KEY' && !recaptchaToken) {
        showToast('请完成人机验证', 'error');
        return;
    }
    
    // 禁用按钮防止重复提交
    const loginBtn = document.getElementById('loginBtn');
    loginBtn.disabled = true;
    loginBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> 登录中...';
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username,
                password,
                recaptchaToken
            })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            showToast('登录成功，正在跳转...');
            // 跳转到首页
            setTimeout(() => {
                window.location.href = '/';
            }, 1000);
        } else {
            showToast(data.error || '登录失败，请检查用户名和密码', 'error');
            // 重置reCAPTCHA
            if (grecaptcha) {
                grecaptcha.reset();
            }
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