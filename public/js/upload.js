document.addEventListener('DOMContentLoaded', function() {
    const fileInput = document.getElementById('fileInput');
    const uploadBtn = document.getElementById('uploadBtn');
    const uploadForm = document.getElementById('uploadForm');
    const progressContainer = document.getElementById('uploadProgressContainer');
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB in bytes

    // Firefox bug fix
    fileInput.addEventListener('focus', function() {
        fileInput.classList.add('focus');
    });
    fileInput.addEventListener('blur', function() {
        fileInput.classList.remove('focus');
    });

    // 更新文件列表显示
    function updateFileList() {
        const files = Array.from(fileInput.files);
        let fileListContainer = document.getElementById('fileListContainer');
        
        if (!fileListContainer) {
            fileListContainer = document.createElement('div');
            fileListContainer.id = 'fileListContainer';
            fileListContainer.className = 'file-list-container mt-3';
            progressContainer.parentNode.insertBefore(fileListContainer, progressContainer);
        }
        
        fileListContainer.innerHTML = '';
        
        if (files.length > 0) {
            // 计算总大小
            const totalSize = files.reduce((acc, file) => acc + file.size, 0);
            
            // 添加总计信息
            const totalInfo = document.createElement('div');
            totalInfo.className = 'alert alert-info mb-3';
            totalInfo.innerHTML = `已选择 ${files.length} 个文件，总大小：${formatFileSize(totalSize)}`;
            fileListContainer.appendChild(totalInfo);
            
            // 添加文件列表
            files.forEach((file, index) => {
                const fileItem = document.createElement('div');
                fileItem.className = 'file-list-item';
                fileItem.innerHTML = `
                    <div class="file-info">
                        <i class="bi bi-file-earmark me-2"></i>
                        <span class="file-list-name">${file.name}</span>
                        <span class="badge bg-secondary ms-2">${formatFileSize(file.size)}</span>
                    </div>
                    <button type="button" class="btn-close btn-close-sm" aria-label="删除" data-index="${index}"></button>
                `;
                fileListContainer.appendChild(fileItem);
                
                // 添加删除按钮事件
                const deleteBtn = fileItem.querySelector('.btn-close');
                deleteBtn.addEventListener('click', () => removeFile(index));
            });
            
            fileListContainer.style.display = 'block';
        } else {
            fileListContainer.style.display = 'none';
        }
    }

    // 删除单个文件
    function removeFile(index) {
        const files = Array.from(fileInput.files);
        const dataTransfer = new DataTransfer();
        
        files.forEach((file, i) => {
            if (i !== index) {
                dataTransfer.items.add(file);
            }
        });
        
        fileInput.files = dataTransfer.files;
        updateFileList();
        uploadBtn.disabled = !fileInput.files.length;
    }

    // Enable upload button when files are selected and check file sizes
    fileInput.addEventListener('change', function() {
        const files = Array.from(fileInput.files);
        const largeFiles = files.filter(file => file.size > MAX_FILE_SIZE);
        
        if (largeFiles.length > 0) {
            // 创建大文件列表
            const fileList = largeFiles.map(file => `${file.name} (${formatFileSize(file.size)})`).join('\n');
            showToast(`以下文件超过50MB，请直接在Telegram中发送：\n${fileList}`, 'error');
            
            // 从选择列表中移除大文件
            const smallFiles = files.filter(file => file.size <= MAX_FILE_SIZE);
            
            // 创建新的 FileList 对象
            const dataTransfer = new DataTransfer();
            smallFiles.forEach(file => dataTransfer.items.add(file));
            fileInput.files = dataTransfer.files;
        }

        uploadBtn.disabled = !fileInput.files.length;
        // 清空进度条容器
        progressContainer.innerHTML = '';
        progressContainer.style.display = 'none';
        // 更新文件列表
        updateFileList();
    });

    // 格式化文件大小
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // 格式化上传速度
    function formatSpeed(bytesPerSecond) {
        if (bytesPerSecond === 0) return '0 B/s';
        const k = 1024;
        const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
        const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
        return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // 创建进度条元素
    function createProgressElement(file) {
        const progressDiv = document.createElement('div');
        progressDiv.className = 'file-progress';
        progressDiv.innerHTML = `
            <div class="file-progress-header">
                <span class="file-name">${file.name}</span>
                <span class="upload-status">准备上传</span>
            </div>
            <div class="progress-info">
                <div class="progress">
                    <div class="progress-bar" role="progressbar" style="width: 0%" 
                         aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
                        <span class="progress-percentage">0%</span>
                    </div>
                </div>
                <div class="upload-details">
                    <span class="upload-speed">速度: 0 B/s</span>
                    <span class="upload-size">0 B / ${formatFileSize(file.size)}</span>
                </div>
            </div>
        `;
        return progressDiv;
    }

    // 更新进度条
    function updateProgress(progressElement, loaded, total, startTime) {
        const progressBar = progressElement.querySelector('.progress-bar');
        const statusElement = progressElement.querySelector('.upload-status');
        const speedElement = progressElement.querySelector('.upload-speed');
        const sizeElement = progressElement.querySelector('.upload-size');
        const percentageElement = progressElement.querySelector('.progress-percentage');
        
        const percentage = Math.round((loaded / total) * 100);
        const elapsedTime = (Date.now() - startTime) / 1000; // 转换为秒
        const speed = loaded / elapsedTime; // 字节/秒
        
        progressBar.style.width = `${percentage}%`;
        progressBar.setAttribute('aria-valuenow', percentage);
        percentageElement.textContent = `${percentage}%`;
        speedElement.textContent = `速度: ${formatSpeed(speed)}`;
        sizeElement.textContent = `${formatFileSize(loaded)} / ${formatFileSize(total)}`;
    }

    // 更新上传状态
    function updateStatus(progressElement, status) {
        const statusElement = progressElement.querySelector('.upload-status');
        statusElement.textContent = status;
        if (status === '上传成功') {
            statusElement.className = 'upload-status upload-success';
        } else if (status.includes('失败')) {
            statusElement.className = 'upload-status upload-error';
        } else {
            statusElement.className = 'upload-status';
        }
    }

    // 处理文件上传
    async function uploadFile(file, progressElement) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('parent_id', currentFolderId || '');

        try {
            // 创建上传请求
            const xhr = new XMLHttpRequest();
            const startTime = Date.now();
            
            // 设置进度监听
            xhr.upload.onprogress = function(e) {
                if (e.lengthComputable) {
                    updateProgress(progressElement, e.loaded, e.total, startTime);
                }
            };

            // 包装 XHR 请求为 Promise
            const uploadPromise = new Promise((resolve, reject) => {
                xhr.onload = function() {
                    if (xhr.status === 200) {
                        try {
                            const response = JSON.parse(xhr.responseText);
                            resolve(response);
                        } catch (error) {
                            reject(new Error('Invalid response format'));
                        }
                    } else {
                        reject(new Error(`Upload failed: ${xhr.statusText}`));
                    }
                };
                
                xhr.onerror = function() {
                    reject(new Error('Network error occurred'));
                };
            });

            // 发送请求
            xhr.open('POST', '/api/upload', true);
            xhr.send(formData);

            // 等待上传完成
            const result = await uploadPromise;
            
            // 更新进度条状态
            updateProgress(progressElement, file.size, file.size, startTime);
            updateStatus(progressElement, '上传成功');
            return true;
        } catch (error) {
            console.error('Upload error:', error);
            updateStatus(progressElement, '上传失败：' + error.message);
            return false;
        }
    }

    // 处理多文件上传
    uploadBtn.addEventListener('click', async function() {
        const files = Array.from(fileInput.files);
        if (!files.length) return;

        // 禁用上传按钮和文件输入
        uploadBtn.disabled = true;
        fileInput.disabled = true;

        // 显示进度条容器
        progressContainer.style.display = 'block';
        progressContainer.innerHTML = '';

        // 创建所有文件的进度条
        const progressElements = files.map(file => {
            const elem = createProgressElement(file);
            progressContainer.appendChild(elem);
            return elem;
        });

        // 上传所有文件
        const results = await Promise.all(files.map((file, index) => {
            return uploadFile(file, progressElements[index]);
        }));

        // 检查所有文件是否上传成功
        const allSuccess = results.every(result => result);
        
        if (allSuccess) {
            showToast('所有文件上传成功');
            // 重新加载文件列表
            if (typeof loadFiles === 'function') {
                loadFiles().then(() => {
                    // 清理上传状态
                    uploadBtn.disabled = false;
                    fileInput.disabled = false;
                    fileInput.value = '';
                    const fileListContainer = document.getElementById('fileListContainer');
                    if (fileListContainer) {
                        fileListContainer.innerHTML = '';
                        fileListContainer.style.display = 'none';
                    }
                    // 隐藏进度条
                    progressContainer.style.display = 'none';
                });
            }
        } else {
            showToast('部分文件上传失败', 'error');
            uploadBtn.disabled = false;
            fileInput.disabled = false;
        }
    });

    // 显示提示信息
    function showToast(message, type = 'success') {
        if (typeof Toastify === 'function') {
            Toastify({
                text: message,
                duration: 3000,
                gravity: "top",
                position: 'right',
                backgroundColor: type === 'success' ? '#4caf50' : '#f44336',
                className: "toastify-multiline"
            }).showToast();
        } else {
            alert(message);
        }
    }
});