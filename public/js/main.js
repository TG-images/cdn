window.FileManager = {
    currentFolderId: null,
    selectedFileId: null,
    pendingDeleteId: null,
    pendingDeleteIsFolder: false,
    pendingBatchDeleteFiles: null,
    selectedItemId: null,
    // 分页相关变量
    currentPage: 1,
    totalPages: 1,
    pageSize: 10,
    allFiles: [], // 存储当前文件夹中的所有文件
    // 排序相关变量
    currentSortField: 'name',
    currentSortOrder: 'asc',
    // 文件夹大小缓存
    folderSizeCache: {},
    // Modal 变量
    newFolderModal: null,
    moveModal: null,
    batchMoveModal: null,
    confirmDeleteModal: null,
    renameModal: null,
    // 添加进行中标记，避免重复请求
    pendingFolderSizeRequests: {},
    calculatingSizes: new Set()
};

// 初始化 Modal
function initializeModals() {
    try {
        // 确保 Bootstrap 已加载
        if (typeof bootstrap === 'undefined') {
            console.error('Bootstrap 未加载');
            return;
        }

        // 等待DOM完全加载
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                initializeModalsAfterLoad();
            });
        } else {
            initializeModalsAfterLoad();
        }
    } catch (error) {
        console.error('Modal 初始化错误:', error);
    }
}

function initializeModalsAfterLoad() {
    try {
        // 获取 Modal 元素
        const newFolderModalEl = document.getElementById('newFolderModal');
        const moveModalEl = document.getElementById('moveModal');
        const batchMoveModalEl = document.getElementById('batchMoveModal');
        const confirmDeleteModalEl = document.getElementById('confirmDeleteModal');
        const renameModalEl = document.getElementById('renameModal');

        // 检查元素是否存在并初始化
        if (newFolderModalEl && !FileManager.newFolderModal) {
            FileManager.newFolderModal = new bootstrap.Modal(newFolderModalEl, {
                backdrop: 'static',
                keyboard: false
            });
        }
        if (moveModalEl && !FileManager.moveModal) {
            FileManager.moveModal = new bootstrap.Modal(moveModalEl, {
                backdrop: 'static',
                keyboard: false
            });
        }
        if (batchMoveModalEl && !FileManager.batchMoveModal) {
            FileManager.batchMoveModal = new bootstrap.Modal(batchMoveModalEl, {
                backdrop: 'static',
                keyboard: false
            });
        }
        if (confirmDeleteModalEl && !FileManager.confirmDeleteModal) {
            FileManager.confirmDeleteModal = new bootstrap.Modal(confirmDeleteModalEl, {
                backdrop: 'static',
                keyboard: false
            });
            
            // 绑定确认删除按钮的点击事件
            const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
            if (confirmDeleteBtn && !confirmDeleteBtn.onclick) {
                confirmDeleteBtn.onclick = performDelete;
                console.log('已绑定确认删除按钮点击事件');
            }
        }
        if (renameModalEl && !FileManager.renameModal) {
            FileManager.renameModal = new bootstrap.Modal(renameModalEl, {
                backdrop: 'static',
                keyboard: false
            });
        }
    } catch (error) {
        console.error('Modal 初始化错误:', error);
    }
}

// 页面加载时初始化 Modal
document.addEventListener('DOMContentLoaded', initializeModals);

// 显示提示信息
function showToast(message, type = 'info') {
    const options = {
        text: message,
        duration: 3000,
        gravity: "top",
        position: "right",
        style: {
            background: type === 'error' ? '#dc3545' : type === 'success' ? '#28a745' : '#17a2b8',
            color: 'white',
            borderRadius: '4px',
            padding: '10px 15px',
            fontSize: '14px',
            boxShadow: '0 3px 6px rgba(0,0,0,0.16)'
        }
    };
    
    Toastify(options).showToast();
}

// 格式化文件大小
function formatSize(bytes) {
    if (bytes === null || bytes === undefined) return '-';
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Byte';
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
}

// 获取文件夹路径
async function getFolderPath(folderId) {
    if (!folderId) return [];
    
    try {
        // 获取所有文件
        const response = await fetch('/api/files?all=true');
        const data = await response.json();
        
        // 处理API返回的不同格式
        let folders = [];
        if (data.files && Array.isArray(data.files)) {
            folders = data.files.filter(f => f.is_folder);
        } else if (Array.isArray(data)) {
            folders = data.filter(f => f.is_folder);
        } else {
            console.error('API返回的数据格式不正确:', data);
            return [];
        }
        
        // 递归函数，用于构建路径
        function buildPath(id) {
            const folder = folders.find(f => f.id.toString() === id.toString());
            if (!folder) return [];
            
            if (folder.parent_id !== null) {
                const parentPath = buildPath(folder.parent_id);
                // 确保folder对象包含name属性
                if (!folder.name && folder.filename) {
                    folder.name = folder.filename;
                }
                return [...parentPath, folder];
            }
            
            return [folder];
        }
        
        return buildPath(folderId);
    } catch (error) {
        console.error('Error getting folder path:', error);
        return [];
    }
}

// 计算文件夹大小
async function calculateFolderSize(folderId) {
    try {
        // 检查缓存
        if (FileManager.folderSizeCache[folderId] !== undefined) {
            return FileManager.folderSizeCache[folderId];
        }

        // 检查是否正在计算中
        if (FileManager.calculatingSizes.has(folderId)) {
            return 0; // 返回0，避免重复计算
        }

        FileManager.calculatingSizes.add(folderId);

        const response = await fetch(`/api/folders/${folderId}/size`);
        if (!response.ok) {
            throw new Error('获取文件夹大小失败');
        }
        const data = await response.json();
        const size = data.size || 0;

        // 更新缓存
        FileManager.folderSizeCache[folderId] = size;
        FileManager.calculatingSizes.delete(folderId);

        return size;
    } catch (error) {
        console.error('计算文件夹大小失败:', error);
        FileManager.calculatingSizes.delete(folderId);
        return 0;
    }
}

// 本地计算文件夹大小（作为备选方案）
function calculateFolderSizeLocally(folderId) {
    try {
        // 使用深度优先搜索递归计算
        let totalSize = 0;
        
        function dfs(folder_id) {
            // 获取当前文件夹的直接子文件和子文件夹
            const children = allFiles.filter(file => file.parent_id == folder_id);
            
            for (const child of children) {
                if (child.is_folder) {
                    // 递归计算子文件夹大小
                    dfs(child.id);
                } else {
                    // 累加文件大小
                    totalSize += parseInt(child.file_size || child.size || 0, 10);
                }
            }
        }
        
        dfs(folderId);
        return totalSize;
    } catch (error) {
        console.error('本地计算文件夹大小失败:', error);
        return 0;
    }
}

// 加载文件列表
async function loadFiles() {
    try {
        console.log('Loading files for folder:', FileManager.currentFolderId);
        const response = await fetch(`/api/files?parent_id=${FileManager.currentFolderId || ''}`, {
            credentials: 'include' // 确保包含Cookie
        });
        console.log('Files API response status:', response.status);
        
        if (response.status === 401 || response.status === 403) {
            // 未登录，重定向到登录页
            console.log('用户未登录，重定向到登录页');
            window.location.href = '/login.html';
            return;
        }
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            console.error('Invalid content type:', contentType);
            throw new Error('服务器返回了非JSON格式的数据');
        }
        
        const data = await response.json();
        console.log('文件列表响应:', data);
        
        // 检查是否需要重定向
        if (data.redirect) {
            console.log('服务器要求重定向:', data.redirect);
            window.location.href = data.redirect;
            return;
        }
        
        // 处理文件列表数据 - 增强版
        console.log('处理文件数据，数据类型:', typeof data, Array.isArray(data) ? '是数组' : '不是数组');
        if (data && typeof data === 'object') {
            if (data.files && Array.isArray(data.files)) {
                console.log('直接使用data.files数组');
                FileManager.allFiles = data.files;
            } else if (Array.isArray(data)) {
                console.log('直接使用data数组');
                FileManager.allFiles = data;
            } else {
                console.error('API返回的数据格式不正确, data:', data);
                FileManager.allFiles = [];
            }
        } else {
            console.error('API返回的数据不是对象:', data);
            FileManager.allFiles = [];
        }
        console.log('Loaded files:', FileManager.allFiles);
        
        // 更新面包屑
        const folderPath = await getFolderPath(FileManager.currentFolderId);
        console.log('Current folder path:', folderPath);
        updateBreadcrumb(folderPath);
        
        // 应用分页
        renderFileList();
    } catch (error) {
        console.error('Error loading files:', error);
        showToast(`加载文件列表失败: ${error.message}`, 'error');
    }
}

// 排序文件
function sortFiles(files, field = 'name', order = 'asc') {
    const sortedFiles = [...files];
    
    sortedFiles.sort((a, b) => {
        // 确保文件夹始终在最上方
        if (a.is_folder !== b.is_folder) {
            return b.is_folder - a.is_folder;
        }
        
        // 如果是文件夹，则按名称排序
        if (a.is_folder && b.is_folder) {
            return a.name.localeCompare(b.name);
        }
        
        // 其他情况按指定字段排序
        let valueA = a[field];
        let valueB = b[field];
        
        if (field === 'size') {
            valueA = a.is_folder ? FileManager.folderSizeCache[a.id] || 0 : a.size;
            valueB = b.is_folder ? FileManager.folderSizeCache[b.id] || 0 : b.size;
        }
        
        if (valueA === valueB) return 0;
        return order === 'asc' ? 
            (valueA < valueB ? -1 : 1) : 
            (valueA > valueB ? -1 : 1);
    });
    
    return sortedFiles;
}

// 处理排序点击事件
function handleSort(field) {
    if (FileManager.currentSortField === field) {
        // 如果点击的是当前排序字段，切换排序顺序
        FileManager.currentSortOrder = FileManager.currentSortOrder === 'asc' ? 'desc' : 'asc';
        } else {
        // 如果点击的是新字段，设置为升序
        FileManager.currentSortField = field;
        FileManager.currentSortOrder = 'asc';
    }
    
    // 更新排序图标
    updateSortIcon();
    
    // 重新渲染文件列表
    renderFileList();
}

// 更新排序图标
function updateSortIcon() {
    // 移除所有列的排序图标
    document.querySelectorAll('th .sort-icon').forEach(icon => icon.remove());
    
    // 添加当前排序列的图标
    const th = document.querySelector(`th[data-sort="${FileManager.currentSortField}"]`);
    if (th) {
        const icon = document.createElement('span');
        icon.className = 'sort-icon ms-1';
        icon.innerHTML = FileManager.currentSortOrder === 'asc' ? '↑' : '↓';
        th.appendChild(icon);
    }
}

// 渲染文件列表（带分页）
async function renderFileList() {
    const fileList = document.getElementById('fileList');
    if (!fileList) return;

    // 确保FileManager.filteredFiles存在
    if (!FileManager.filteredFiles) {
        FileManager.filteredFiles = FileManager.allFiles || [];
    }

    const start = (FileManager.currentPage - 1) * FileManager.pageSize;
    const end = start + FileManager.pageSize;
    const filesToShow = FileManager.filteredFiles.slice(start, end);

    fileList.innerHTML = '';
    let index = start + 1;

    for (const file of filesToShow) {
        const row = document.createElement('tr');
        row.dataset.id = file.id;
        row.dataset.isFolder = file.is_folder;

        // 添加复选框
        const checkboxCell = document.createElement('td');
        checkboxCell.className = 'col-checkbox';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'file-checkbox';
        checkbox.dataset.id = file.id;
        checkboxCell.appendChild(checkbox);
        row.appendChild(checkboxCell);

        // 添加序号
        const numberCell = document.createElement('td');
        numberCell.className = 'col-number';
        numberCell.textContent = index++;
        row.appendChild(numberCell);

        // 添加名称
        const nameCell = document.createElement('td');
        nameCell.className = 'col-name';
        const nameDiv = document.createElement('div');
        nameDiv.className = 'd-flex align-items-center';
        
        const icon = document.createElement('i');
        icon.className = file.is_folder ? 'bi bi-folder me-2' : 'bi bi-file-earmark me-2';
        nameDiv.appendChild(icon);
        
        const nameSpan = document.createElement('span');
        if (file.is_folder) {
            const folderLink = document.createElement('a');
            folderLink.href = '#';
            folderLink.textContent = file.filename;
            folderLink.onclick = (e) => {
                e.preventDefault();
                FileManager.currentFolderId = file.id;
                FileManager.currentPage = 1;
                loadFiles();
            };
            nameSpan.appendChild(folderLink);
        } else {
            nameSpan.textContent = file.filename;
        }
        nameDiv.appendChild(nameSpan);
        
        nameCell.appendChild(nameDiv);
        row.appendChild(nameCell);

        // 添加大小
        const sizeCell = document.createElement('td');
        sizeCell.className = 'col-size';
        if (file.is_folder) {
            const size = FileManager.folderSizeCache[file.id] !== undefined ? 
                FileManager.folderSizeCache[file.id] : 0;
            sizeCell.textContent = formatSize(size);
        } else {
            sizeCell.textContent = formatSize(file.size);
        }
        row.appendChild(sizeCell);

        // 添加日期
        const dateCell = document.createElement('td');
        dateCell.className = 'col-date';
        dateCell.textContent = moment(file.created_at).format('YYYY-MM-DD HH:mm:ss');
        row.appendChild(dateCell);

        // 添加操作按钮
        const actionsCell = document.createElement('td');
        actionsCell.className = 'col-actions';
        const btnGroup = document.createElement('div');
        btnGroup.className = 'btn-group';
        
        if (file.is_folder) {
            const openBtn = document.createElement('button');
            openBtn.className = 'btn btn-sm btn-outline-primary';
            openBtn.innerHTML = '<i class="bi bi-folder2-open me-1"></i>打开';
            openBtn.title = '打开文件夹';
            openBtn.onclick = () => {
                FileManager.currentFolderId = file.id;
                FileManager.currentPage = 1;
                loadFiles();
            };
            btnGroup.appendChild(openBtn);
        } else {
            const previewBtn = document.createElement('button');
            previewBtn.className = 'btn btn-sm btn-outline-primary';
            previewBtn.innerHTML = '<i class="bi bi-eye me-1"></i>预览';
            previewBtn.title = '预览';
            previewBtn.onclick = () => previewFile(file.id);
            btnGroup.appendChild(previewBtn);
        }

        const moveBtn = document.createElement('button');
        moveBtn.className = 'btn btn-sm btn-outline-info';
        moveBtn.innerHTML = '<i class="bi bi-folder-symlink me-1"></i>移动';
        moveBtn.title = '移动';
        moveBtn.onclick = () => showMoveModal(file.id);
        btnGroup.appendChild(moveBtn);

        const renameBtn = document.createElement('button');
        renameBtn.className = 'btn btn-sm btn-outline-secondary';
        renameBtn.innerHTML = '<i class="bi bi-pencil me-1"></i>重命名';
        renameBtn.title = '重命名';
        renameBtn.onclick = () => showRenameModal(file.id, file.name);
        btnGroup.appendChild(renameBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-sm btn-outline-danger';
        deleteBtn.innerHTML = '<i class="bi bi-trash me-1"></i>删除';
        deleteBtn.title = '删除';
        deleteBtn.onclick = () => deleteFile(file.id, file.is_folder);
        btnGroup.appendChild(deleteBtn);

        actionsCell.appendChild(btnGroup);
        row.appendChild(actionsCell);

        fileList.appendChild(row);
    }
}

// 更新面包屑
function updateBreadcrumb(folderPath) {
    const breadcrumb = document.querySelector('#breadcrumb ol');
    breadcrumb.innerHTML = '';
    
    // 添加根目录
    const rootItem = document.createElement('li');
    rootItem.className = 'breadcrumb-item';
    rootItem.innerHTML = `<a href="#" data-id="null">根目录</a>`;
    breadcrumb.appendChild(rootItem);
    
    // 添加文件夹路径
    if (folderPath && folderPath.length > 0) {
        folderPath.forEach((folder, index) => {
            const item = document.createElement('li');
            item.className = 'breadcrumb-item';
            if (index === folderPath.length - 1) {
                item.classList.add('active');
                item.innerHTML = folder.name;
            } else {
                item.innerHTML = `<a href="#" data-id="${folder.id}">${folder.name}</a>`;
            }
            breadcrumb.appendChild(item);
        });
    }
    
    // 添加面包屑点击事件
    breadcrumb.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', (e) => {
    e.preventDefault();
            currentFolderId = link.dataset.id === 'null' ? null : link.dataset.id;
            currentPage = 1; // 重置为第一页
            loadFiles();
        });
    });
}

// 显示新建文件夹模态框
function showNewFolderModal() {
    // 清空输入框
    document.getElementById('folderName').value = '';
    // 显示模态框
    FileManager.newFolderModal.show();
    // 显示后自动聚焦到输入框
    setTimeout(() => {
        document.getElementById('folderName').focus();
    }, 500);
}

// 创建文件夹
async function createFolder() {
    const name = document.getElementById('folderName').value.trim();
    if (!name) {
        showToast('请输入文件夹名称', 'error');
        return;
    }

    try {
        const response = await fetch('/api/folders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                name, 
                parent_id: FileManager.currentFolderId   // 使用FileManager.currentFolderId
            })
        });

        if (response.ok) {
            showToast('文件夹创建成功');
            FileManager.newFolderModal.hide();  // 使用FileManager.newFolderModal
            FileManager.currentPage = 1; // 创建新文件夹后回到第一页
            loadFiles();
        } else {
            const errorData = await response.json();
            showToast(errorData.error || '文件夹创建失败', 'error');
        }
    } catch (error) {
        console.error('创建文件夹出错:', error);
        showToast('文件夹创建失败', 'error');
    }
}

// 检查是否是子文件夹
async function isSubfolder(parentId, targetId) {
    if (!parentId || !targetId) return false;
    if (parentId.toString() === targetId.toString()) return true;

    try {
        const response = await fetch(`/api/files?all=true`);
        const files = await response.json();
        const folders = files.filter(f => f.is_folder);

        // 递归检查是否是子文件夹
        function checkSubfolder(currentId) {
            const folder = folders.find(f => f.id.toString() === currentId.toString());
            if (!folder || folder.parent_id === null) return false;
            
            const children = folders.filter(f => f.parent_id?.toString() === folder.id.toString());
            return children.some(child => 
                child.id.toString() === targetId.toString() || 
                checkSubfolder(child.id)
            );
        }

        return checkSubfolder(parentId);
    } catch (error) {
        console.error('Error checking subfolder:', error);
        return false;
    }
}

// 同步版本的isSubfolder函数，避免重复API调用
function isSubfolderSync(currentId, targetId, allFiles) {
    if (!currentId || !targetId) return false;
    if (currentId.toString() === targetId.toString()) return true;

    const folders = allFiles.filter(f => f.is_folder);
    
    // 检查当前文件夹是否是目标文件夹的子孙文件夹
    function isDescendant(folderId) {
        const folder = folders.find(f => f.id.toString() === folderId.toString());
        if (!folder || folder.parent_id === null) return false;
        
        // 如果当前文件夹的父文件夹是目标文件夹，或者是目标文件夹的子孙文件夹，则返回true
        return folder.parent_id.toString() === targetId.toString() || 
               isDescendant(folder.parent_id);
    }

    // 从当前文件夹开始，向上检查是否能找到目标文件夹
    return isDescendant(currentId);
}

// 检查是否是父文件夹
function isParentFolder(folderId, fileId, allFiles) {
    const file = allFiles.find(f => f.id.toString() === fileId.toString());
    return file && file.parent_id?.toString() === folderId.toString();
}

// 创建单个文件夹项及其子项
async function createFolderItem(folder, container, currentFileIds, level = 0, allFiles = null) {
    // 如果没有传入allFiles，则获取所有文件
    if (!allFiles) {
        const response = await fetch(`/api/files?all=true`);
        allFiles = await response.json();
    }
    
    // 检查是否禁用
    const isDisabled = currentFileIds && (
        Array.isArray(currentFileIds) 
            ? currentFileIds.map(id => {
                // 检查每个选中的文件
                const currentFile = allFiles.find(f => f.id.toString() === id.toString());
                if (!currentFile) return false;

                return folder.id.toString() === id.toString() || // 当前文件夹本身
                       isSubfolderSync(folder.id, id, allFiles) || // 目标文件夹是当前文件夹的子孙文件夹
                       isParentFolder(folder.id, id, allFiles); // 目标文件夹是当前文件夹的父文件夹
            }).some(result => result)
            : folder.id.toString() === currentFileIds.toString() || // 当前文件夹本身
              isSubfolderSync(folder.id, currentFileIds, allFiles) || // 目标文件夹是当前文件夹的子孙文件夹
              isParentFolder(folder.id, currentFileIds, allFiles) // 目标文件夹是当前文件夹的父文件夹
    );

    // 创建文件夹项容器
    const folderItem = document.createElement('div');
    folderItem.className = 'folder-item' + (isDisabled ? ' disabled' : '');
    folderItem.dataset.id = folder.id;
    folderItem.dataset.level = level;

    // 查找子文件夹（从已有的allFiles中筛选，不再发送请求）
    const childFolders = allFiles.filter(f => f.is_folder && f.parent_id?.toString() === folder.id.toString());
    const hasChildren = childFolders.length > 0;

    // 添加文件夹内容
    folderItem.innerHTML = `
        <span class="folder-toggle" ${!hasChildren ? 'style="visibility: hidden;"' : ''}>-</span>
        <input type="radio" name="${container.closest('#batchFolderTree') ? 'batch_target_folder' : 'target_folder'}" 
               value="${folder.id}" 
               id="${container.closest('#batchFolderTree') ? 'batch_folder_' : 'folder_'}${folder.id}"
               ${isDisabled ? 'disabled' : ''}>
        <span class="folder-name">📁 ${folder.filename || folder.name}</span>
    `;

    // 添加到容器
    container.appendChild(folderItem);

    // 如果有子文件夹，创建子容器并添加切换功能
    if (hasChildren) {
        // 创建子文件夹容器
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'folder-children';
        childrenContainer.dataset.parentId = folder.id;
        childrenContainer.style.display = 'block'; // 默认展开
        container.appendChild(childrenContainer);

        // 添加展开/折叠事件
        const toggle = folderItem.querySelector('.folder-toggle');
        toggle.addEventListener('click', function(e) {
            e.stopPropagation();
            const childrenDiv = this.closest('.folder-item').nextElementSibling;
            if (childrenDiv && childrenDiv.classList.contains('folder-children')) {
                const isExpanded = childrenDiv.style.display === 'block';
                this.textContent = isExpanded ? '+' : '-';
                childrenDiv.style.display = isExpanded ? 'none' : 'block';
            }
        });

        // 立即加载所有子文件夹（递归加载）
        for (const childFolder of childFolders) {
            await createFolderItem(childFolder, childrenContainer, currentFileIds, level + 1, allFiles);
        }
    }

    // 添加单选框点击事件
    const radio = folderItem.querySelector('input[type="radio"]');
    radio.addEventListener('click', (e) => {
        if (isDisabled) {
            e.preventDefault();
            showToast('不能移动到当前文件夹、子文件夹或当前所在的文件夹', 'error');
        }
    });

    // 添加文件夹名称点击事件
    const folderName = folderItem.querySelector('.folder-name');
    folderName.addEventListener('click', (e) => {
        if (!isDisabled) {
            const radio = folderItem.querySelector('input[type="radio"]');
            radio.checked = true;
            // 触发一个change事件，以便其他可能依赖此事件的代码能够正常工作
            const event = new Event('change', { bubbles: true });
            radio.dispatchEvent(event);
        } else {
            showToast('不能移动到当前文件夹、子文件夹或当前所在的文件夹', 'error');
        }
    });

    return folderItem;
}

// 加载文件夹树
async function loadFolderTree(parentId, container, currentFileId = null) {
    try {
        // 清空容器
        container.innerHTML = '';
        
        // 获取所有文件
        const response = await fetch('/api/files?all=true');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // 处理API返回的不同格式
        let allFiles = [];
        if (data.files && Array.isArray(data.files)) {
            allFiles = data.files;
        } else if (Array.isArray(data)) {
            allFiles = data;
        } else {
            console.error('API返回的数据格式不正确:', data);
            throw new Error('返回的数据格式不正确');
        }
        
        // 添加根目录项
        const rootItem = document.createElement('div');
        rootItem.className = 'folder-item';
        
        // 检查是否需要禁用根目录（仅当当前文件在根目录时）
        let isRootDisabled = false;
        if (currentFileId) {
            const currentFile = Array.isArray(currentFileId) 
                ? allFiles.find(f => currentFileId.includes(f.id.toString()))
                : allFiles.find(f => f.id.toString() === currentFileId.toString());
            isRootDisabled = currentFile && currentFile.parent_id === null;
        }
        
        rootItem.innerHTML = `
            <span class="folder-toggle" style="visibility: hidden;">+</span>
            <input type="radio" name="${container.id === 'batchFolderTree' ? 'batch_target_folder' : 'target_folder'}" 
                   id="${container.id === 'batchFolderTree' ? 'batch_folder_root' : 'folder_root'}"
                   value="null" ${isRootDisabled ? 'disabled' : ''}>
            <span class="folder-name">📁 根目录</span>
        `;
        container.appendChild(rootItem);
        
        // 添加根目录名称点击事件
        const rootFolderName = rootItem.querySelector('.folder-name');
        rootFolderName.addEventListener('click', () => {
            if (!isRootDisabled) {
                const rootRadio = rootItem.querySelector('input[type="radio"]');
                rootRadio.checked = true;
                // 触发change事件
                const event = new Event('change', { bubbles: true });
                rootRadio.dispatchEvent(event);
            } else {
                showToast('不能移动到当前文件夹', 'error');
            }
        });
        
        // 获取根目录下的文件夹
        const folders = allFiles.filter(f => f.is_folder && f.parent_id === null);
        
        // 如果有子文件夹，创建根目录的子容器
        if (folders.length > 0) {
            // 更新根目录的折叠图标
            const rootToggle = rootItem.querySelector('.folder-toggle');
            rootToggle.style.visibility = 'visible';
            rootToggle.textContent = '-'; // 默认展开显示"-"
            
            // 创建根目录的子容器
            const rootChildrenContainer = document.createElement('div');
            rootChildrenContainer.className = 'folder-children';
            rootChildrenContainer.style.display = 'block'; // 默认展开
            container.appendChild(rootChildrenContainer);
            
            // 为根目录添加折叠/展开事件
            rootToggle.addEventListener('click', function(e) {
                e.stopPropagation();
                const childrenDiv = rootItem.nextElementSibling;
                if (childrenDiv && childrenDiv.classList.contains('folder-children')) {
                    const isExpanded = childrenDiv.style.display === 'block';
                    this.textContent = isExpanded ? '+' : '-';
                    childrenDiv.style.display = isExpanded ? 'none' : 'block';
                }
            });
            
            // 立即加载子文件夹（不使用延迟加载）
            for (const folder of folders) {
                await createFolderItem(folder, rootChildrenContainer, currentFileId, 0, allFiles);
            }
        }
    } catch (error) {
        console.error('Error loading folder tree:', error);
        showToast('加载文件夹失败', 'error');
    }
}

// 搜索函数
const performSearch = async (isBatch = false) => {
    const searchInput = document.getElementById('searchInput');
    const folderTree = document.getElementById(isBatch ? 'batchFolderTree' : 'folderTree');
    
    if (!searchInput || !folderTree) {
        console.error('搜索组件未找到');
        return;
    }
    
    const searchTerm = searchInput.value.trim().toLowerCase();
    if (!searchTerm) {
        showToast('请输入搜索关键词', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/files?all=true');
        if (!response.ok) {
            throw new Error('获取文件列表失败');
        }
        
        const data = await response.json();
        let files = [];
        
        if (data.files && Array.isArray(data.files)) {
            files = data.files;
        } else if (Array.isArray(data)) {
            files = data;
        } else {
            console.error('API返回的数据格式不正确:', data);
            throw new Error('返回的数据格式不正确');
        }
        
        const filteredFiles = files.filter(file => 
            (file.filename || file.name || '').toLowerCase().includes(searchTerm)
        );
        
        // 清空当前目录树
        folderTree.innerHTML = '';
        
        // 创建搜索结果容器
        const resultsContainer = document.createElement('div');
        resultsContainer.className = 'search-results';
        resultsContainer.innerHTML = '<h6 class="mb-3">搜索结果：</h6>';
        folderTree.appendChild(resultsContainer);
        
        // 显示搜索结果
        if (filteredFiles.length === 0) {
            resultsContainer.innerHTML += '<div class="text-muted">未找到匹配的文件夹</div>';
        } else {
            // 创建搜索结果树
            const searchTree = document.createElement('div');
            searchTree.className = 'folder-tree';
            resultsContainer.appendChild(searchTree);
            
            // 获取当前选中的文件
            let currentSelectedFiles = [];
            if (isBatch) {
                currentSelectedFiles = Array.from(document.querySelectorAll('.file-checkbox:checked')).map(cb => cb.value);
            }
            
            // 显示文件夹
            for (const folder of filteredFiles) {
                // 检查是否可以移动到该文件夹
                let isDisabled = false;
                if (isBatch) {
                    // 批量移动逻辑
                    isDisabled = currentSelectedFiles.includes(folder.id) || 
                                currentSelectedFiles.some(id => 
                                    isSubfolderSync(folder.id, id, files) || // 目标文件夹是当前文件夹的子孙文件夹
                                    isParentFolder(folder.id, id, files)     // 目标文件夹是当前文件夹的父文件夹
                                );
                } else {
                    // 单个移动逻辑
                    isDisabled = FileManager.selectedFileId === folder.id || 
                                isSubfolderSync(folder.id, FileManager.selectedFileId, files) || // 目标文件夹是当前文件夹的子孙文件夹
                                isParentFolder(folder.id, FileManager.selectedFileId, files);    // 目标文件夹是当前文件夹的父文件夹
                }
                
                const folderItem = document.createElement('div');
                folderItem.className = 'folder-item' + (isDisabled ? ' disabled' : '');
                folderItem.innerHTML = `
                    <input type="radio" name="${isBatch ? 'batch_target_folder' : 'target_folder'}" 
                           value="${folder.id}" 
                           id="search_folder_${folder.id}" 
                           ${isDisabled ? 'disabled' : ''}>
                    <span class="folder-name">📁 ${folder.filename || folder.name}</span>
                `;
                searchTree.appendChild(folderItem);

                // 添加单选框点击事件
                const radio = folderItem.querySelector('input[type="radio"]');
                radio.addEventListener('click', (e) => {
                    if (isDisabled) {
                        e.preventDefault();
                        showToast('不能移动到当前文件夹、子文件夹或父文件夹', 'error');
                    }
                });

                // 添加文件夹名称点击事件
                const folderName = folderItem.querySelector('.folder-name');
                folderName.addEventListener('click', (e) => {
                    if (!isDisabled) {
                        const radio = folderItem.querySelector('input[type="radio"]');
                        radio.checked = true;
                        // 触发一个change事件，以便其他可能依赖此事件的代码能够正常工作
                        const event = new Event('change', { bubbles: true });
                        radio.dispatchEvent(event);
                    } else {
                        showToast('不能移动到当前文件夹、子文件夹或父文件夹', 'error');
                    }
                });
            }
        }
    } catch (error) {
        console.error('Search error:', error);
        showToast('搜索失败：' + error.message, 'error');
        folderTree.innerHTML = '<div class="text-center text-muted">搜索出错，请重试</div>';
    }
};

// 显示移动文件模态框
async function showMoveModal(fileId) {
    FileManager.selectedFileId = fileId;
    const folderTree = document.getElementById('folderTree');
    
    // 添加搜索框和按钮
    const searchContainer = document.createElement('div');
    searchContainer.className = 'search-container mb-3';
    searchContainer.innerHTML = `
        <div class="input-group">
            <input type="text" class="form-control" id="searchInput" placeholder="搜索文件夹...">
            <button class="btn btn-outline-secondary" type="button" id="searchButton">搜索</button>
        </div>
    `;
    folderTree.parentNode.insertBefore(searchContainer, folderTree);
    
    // 使用文件夹树加载函数，默认展开
    await loadFolderTree(null, folderTree, fileId);
    
    // 确保根目录的子容器展开
    const rootChildrenContainer = folderTree.querySelector('.folder-children');
    if (rootChildrenContainer) {
        rootChildrenContainer.style.display = 'block';
    }
    
    // 添加搜索功能
    const searchInput = document.getElementById('searchInput');
    const searchButton = document.getElementById('searchButton');
    
    // 搜索按钮点击事件
    searchButton.addEventListener('click', () => performSearch(false));
    
    // 输入框回车事件
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            performSearch(false);
        }
    });
    
    // 修复辅助功能，在模态框关闭时将焦点移回触发按钮
    const triggerButton = document.activeElement;
    
    FileManager.moveModal._element.addEventListener('hidden.bs.modal', function () {
        if (triggerButton && typeof triggerButton.focus === 'function') {
            setTimeout(() => triggerButton.focus(), 0);
        }
        // 清理搜索框
        if (searchContainer && searchContainer.parentNode) {
            searchContainer.parentNode.removeChild(searchContainer);
        }
    }, { once: true });
    
    FileManager.moveModal.show();
}

// 显示批量移动模态框
async function showBatchMoveModal() {
    const selectedFiles = Array.from(document.querySelectorAll('.file-checkbox:checked')).map(cb => cb.value);
    if (selectedFiles.length === 0) {
        showToast('请选择要移动的文件', 'error');
        return;
    }
    
    const folderTree = document.getElementById('batchFolderTree');
    
    // 添加搜索框和按钮
    const searchContainer = document.createElement('div');
    searchContainer.className = 'search-container mb-3';
    searchContainer.innerHTML = `
        <div class="input-group">
            <input type="text" class="form-control" id="searchInput" placeholder="搜索文件夹...">
            <button class="btn btn-outline-secondary" type="button" id="searchButton">搜索</button>
        </div>
    `;
    folderTree.parentNode.insertBefore(searchContainer, folderTree);
    
    // 使用文件夹树加载函数，默认展开
    await loadFolderTree(null, folderTree, selectedFiles);
    
    // 确保根目录的子容器展开
    const rootChildrenContainer = folderTree.querySelector('.folder-children');
    if (rootChildrenContainer) {
        rootChildrenContainer.style.display = 'block';
    }
    
    // 添加搜索功能
    const searchInput = document.getElementById('searchInput');
    const searchButton = document.getElementById('searchButton');
    
    // 搜索按钮点击事件
    searchButton.addEventListener('click', () => performSearch(true));
    
    // 输入框回车事件
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            performSearch(true);
        }
    });
    
    // 修复辅助功能，在模态框关闭时将焦点移回触发按钮
    const triggerButton = document.activeElement;
    
    FileManager.batchMoveModal._element.addEventListener('hidden.bs.modal', function () {  // 使用FileManager.batchMoveModal
        if (triggerButton && typeof triggerButton.focus === 'function') {
            setTimeout(() => triggerButton.focus(), 0);
        }
        // 清理搜索框
        if (searchContainer && searchContainer.parentNode) {
            searchContainer.parentNode.removeChild(searchContainer);
        }
    }, { once: true });
    
    FileManager.batchMoveModal.show();  // 使用FileManager.batchMoveModal
}

// 移动文件
async function moveFile() {
    const selectedFolder = document.querySelector('input[name="target_folder"]:checked');
    if (!selectedFolder) {
        showToast('请选择目标文件夹', 'error');
        return;
    }
    
    const targetFolderId = selectedFolder.value === 'null' ? null : selectedFolder.value;
    
    console.log('移动文件/文件夹:', {
        fileId: FileManager.selectedFileId,  // 使用FileManager.selectedFileId
        targetFolderId: targetFolderId
    });
    
    try {
        const response = await fetch(`/api/files/${FileManager.selectedFileId}/move`, {  // 使用FileManager.selectedFileId
            method: 'PUT',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ newParentId: targetFolderId })
        });

        console.log('移动响应状态:', response.status);
        const responseText = await response.text();
        console.log('移动响应内容:', responseText);
        
        let responseData;
        try {
            responseData = JSON.parse(responseText);
        } catch (e) {
            responseData = { message: responseText };
        }

        if (response.ok) {
            showToast('移动成功');
            FileManager.moveModal.hide();  // 使用FileManager.moveModal
            // 如果当前页将没有内容了，且不是第一页，则回到上一页
            if (FileManager.allFiles.length <= FileManager.pageSize && FileManager.currentPage > 1) {
                FileManager.currentPage--;
            }
            loadFiles();
        } else {
            const errorMsg = responseData.error || responseData.message || '未知错误';
            console.error('移动失败:', errorMsg);
            showToast(`移动失败: ${errorMsg}`, 'error');
        }
    } catch (error) {
        console.error('移动请求错误:', error);
        showToast(`移动失败: ${error.message}`, 'error');
    }
}

// 删除文件或文件夹
async function deleteFile(id, isFolder) {
    console.log('准备删除:', { id, isFolder });
    // 存储待删除的ID和类型
    FileManager.pendingDeleteId = id;
    FileManager.pendingDeleteIsFolder = isFolder;
    
    // 根据类型设置不同的确认消息
    const confirmMessage = isFolder 
        ? '此操作将递归删除文件夹下的所有文件，是否继续？'
        : '确定要删除此文件吗？';
    
    // 设置确认消息
    document.getElementById('confirmDeleteMessage').textContent = confirmMessage;
    
    // 显示确认对话框
    FileManager.confirmDeleteModal.show();
}

// 实际执行删除操作
async function performDelete() {
    console.log('执行删除操作:', { 
        pendingDeleteId: FileManager.pendingDeleteId, 
        pendingDeleteIsFolder: FileManager.pendingDeleteIsFolder,
        pendingBatchDeleteFiles: FileManager.pendingBatchDeleteFiles 
    });
    
    // 单个文件删除
    if (FileManager.pendingDeleteId !== null) {
        try {
            console.log(`发送删除请求: /api/files/${FileManager.pendingDeleteId}`);
            
            const response = await fetch(`/api/files/${FileManager.pendingDeleteId}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            
            console.log('删除响应状态:', response.status);
            const responseText = await response.text();
            console.log('删除响应内容:', responseText);
            
            let responseData;
            try {
                responseData = JSON.parse(responseText);
            } catch (e) {
                responseData = { message: responseText };
            }

        if (response.ok) {
                showToast('删除成功');
                // 如果当前页没有内容了，且不是第一页，则回到上一页
                if (FileManager.allFiles.length <= FileManager.pageSize && FileManager.currentPage > 1) {
                    FileManager.currentPage--;
                }
                loadFiles();
        } else {
                showToast(`删除失败: ${responseData.error || responseData.message || '未知错误'}`, 'error');
        }
    } catch (error) {
            console.error('Delete error:', error);
            showToast(`删除失败: ${error.message}`, 'error');
        } finally {
            // 关闭确认对话框
            if (FileManager.confirmDeleteModal) {
                FileManager.confirmDeleteModal.hide();
        }
        
        // 重置待删除项
        FileManager.pendingDeleteId = null;
        FileManager.pendingDeleteIsFolder = false;
        }
    }
    // 批量删除
    else if (FileManager.pendingBatchDeleteFiles !== null && FileManager.pendingBatchDeleteFiles.length > 0) {
        console.log('执行批量删除:', FileManager.pendingBatchDeleteFiles);
        
        let success = true;
        let successCount = 0;
        let failCount = 0;
        
        for (const id of FileManager.pendingBatchDeleteFiles) {
            try {
                console.log(`发送批量删除请求: /api/files/${id}`);
                
                const response = await fetch(`/api/files/${id}`, {
                    method: 'DELETE',
                    credentials: 'include'
                });
                
                console.log(`ID ${id} 删除响应状态:`, response.status);
                
                if (response.ok) {
                    successCount++;
                } else {
                    failCount++;
                    success = false;
                }
            } catch (error) {
                console.error(`ID ${id} 删除错误:`, error);
                failCount++;
                success = false;
            }
        }
        
        if (success) {
            showToast('批量删除成功');
        } else if (successCount > 0) {
            showToast(`部分文件删除成功 (${successCount}/${FileManager.pendingBatchDeleteFiles.length})`, 'warning');
    } else {
            showToast('批量删除失败', 'error');
        }
        
        // 如果当前页将没有内容了，且不是第一页，则回到上一页
        const remainingCount = FileManager.allFiles.length - FileManager.pendingBatchDeleteFiles.length;
        const currentPageStart = (FileManager.currentPage - 1) * FileManager.pageSize;
        if (remainingCount <= currentPageStart && FileManager.currentPage > 1) {
            FileManager.currentPage--;
        }
        
        loadFiles();
        
        // 关闭确认对话框
        if (FileManager.confirmDeleteModal) {
            FileManager.confirmDeleteModal.hide();
        }
        
        // 重置待删除项
        FileManager.pendingBatchDeleteFiles = null;
    } else {
        console.warn('没有指定要删除的文件');
        if (FileManager.confirmDeleteModal) {
            FileManager.confirmDeleteModal.hide();
        }
    }
}

// 全选/取消全选
function toggleSelectAll() {
    const checkboxes = document.querySelectorAll('.file-checkbox');
    const selectAll = document.getElementById('selectAll');
    checkboxes.forEach(checkbox => checkbox.checked = selectAll.checked);
}

// 批量删除
async function deleteSelected() {
    const selectedFiles = Array.from(document.querySelectorAll('.file-checkbox:checked')).map(cb => cb.value);
    if (selectedFiles.length === 0) {
        showToast('请选择要删除的文件', 'error');
        return;
    }
    
    // 存储待删除的文件列表
    FileManager.pendingBatchDeleteFiles = selectedFiles;
    
    // 设置确认消息
    document.getElementById('confirmDeleteMessage').textContent = 
        `确定要删除选中的 ${selectedFiles.length} 个文件/文件夹吗？`;
    
    // 显示确认对话框
    FileManager.confirmDeleteModal.show();
}

// 批量移动文件
async function batchMoveFiles() {
    const selectedFolder = document.querySelector('input[name="batch_target_folder"]:checked');
    if (!selectedFolder) {
        showToast('请选择目标文件夹', 'error');
        return;
    }
    
    const selectedFiles = Array.from(document.querySelectorAll('.file-checkbox:checked')).map(cb => cb.value);
    const targetFolderId = selectedFolder.value === 'null' ? null : selectedFolder.value;
    
    // 创建进度条容器
    const progressContainer = document.createElement('div');
    progressContainer.className = 'progress-container mt-3';
    progressContainer.innerHTML = `
        <div class="progress">
            <div class="progress-bar progress-bar-striped progress-bar-animated" 
                 role="progressbar" style="width: 0%">0%</div>
        </div>
        <div class="text-center mt-2">正在移动文件...</div>
    `;
    
    // 添加到模态框
    const modalBody = FileManager.batchMoveModal._element.querySelector('.modal-body');
    modalBody.appendChild(progressContainer);
    
    // 禁用确认按钮
    const confirmBtn = FileManager.batchMoveModal._element.querySelector('.modal-footer .btn-primary');
    confirmBtn.disabled = true;
    
    try {
        // 使用 Promise.all 并行处理移动请求
        const totalFiles = selectedFiles.length;
        let successCount = 0;
        let failedCount = 0;
        
        // 创建所有移动请求
        const movePromises = selectedFiles.map(async (fileId, index) => {
            try {
                const response = await fetch(`/api/files/${fileId}/move`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ newParentId: targetFolderId })
                });
                
                if (response.ok) {
                    successCount++;
                } else {
                    failedCount++;
                    console.error(`移动文件 ${fileId} 失败:`, await response.text());
                }
                
                // 更新进度
                const progress = Math.round(((index + 1) / totalFiles) * 100);
                const progressBar = progressContainer.querySelector('.progress-bar');
                progressBar.style.width = `${progress}%`;
                progressBar.textContent = `${progress}%`;
                
            } catch (error) {
                failedCount++;
                console.error(`移动文件 ${fileId} 时发生错误:`, error);
            }
        });
        
        // 等待所有移动操作完成
        await Promise.all(movePromises);
        
        // 显示结果
        if (successCount === totalFiles) {
            showToast('批量移动成功');
        } else if (successCount > 0) {
            showToast(`部分文件移动成功 (${successCount}/${totalFiles})`, 'warning');
        } else {
            showToast('所有文件移动失败', 'error');
        }
        
        // 关闭模态框并刷新文件列表
        FileManager.batchMoveModal.hide();
        
        // 如果当前页将没有内容了，且不是第一页，则回到上一页
        const remainingCount = FileManager.allFiles.length - selectedFiles.length;
        const currentPageStart = (FileManager.currentPage - 1) * FileManager.pageSize;
        if (remainingCount <= currentPageStart && FileManager.currentPage > 1) {
            FileManager.currentPage--;
        }
        
        loadFiles();
        
    } catch (error) {
        console.error('批量移动出错:', error);
        showToast('批量移动失败', 'error');
    } finally {
        // 清理进度条
        if (progressContainer.parentNode) {
            progressContainer.parentNode.removeChild(progressContainer);
        }
        // 恢复确认按钮
        if (confirmBtn) {
            confirmBtn.disabled = false;
        }
    }
}

// 搜索文件
async function searchFiles() {
    const searchInput = document.getElementById('fileSearchInput');
    const searchTerm = searchInput.value.trim().toLowerCase();
    
    if (!searchTerm) {
        // 如果搜索框为空，显示所有文件
        loadFiles();
        return;
    }
    
    try {
        const response = await fetch('/api/files?all=true');
        if (!response.ok) {
            throw new Error('获取文件列表失败');
        }
        
        const data = await response.json();
        let files = [];
        
        if (data.files && Array.isArray(data.files)) {
            files = data.files;
        } else if (Array.isArray(data)) {
            files = data;
        } else {
            console.error('API返回的数据格式不正确:', data);
            throw new Error('返回的数据格式不正确');
        }
        
        const filteredFiles = files.filter(file => 
            (file.filename || file.name || '').toLowerCase().includes(searchTerm)
        );
        
        // 更新文件列表显示
        const tbody = document.getElementById('fileList');
        tbody.innerHTML = '';
        
        if (filteredFiles.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center">未找到匹配的文件或文件夹</td></tr>';
            return;
        }
        
        // 用于存储加载文件夹大小的Promise
        const folderSizePromises = [];
        
        // 显示搜索结果
        filteredFiles.forEach((file, index) => {
            const tr = document.createElement('tr');
            
            // 如果是文件夹，创建一个大小加载的Promise
            let folderSizePromise = null;
            if (file.is_folder) {
                folderSizePromise = calculateFolderSize(file.id);
                folderSizePromises.push({ id: file.id, promise: folderSizePromise });
            }
            
            tr.innerHTML = `
                <td><input type="checkbox" class="file-checkbox" value="${file.id}"></td>
                <td>${index + 1}</td>
                <td style="text-align: left; padding-left: 8px;">${file.is_folder ? '📁 ' : '📄 '}${
                    file.is_folder 
                    ? `<a href="#" class="folder-link" data-id="${file.id}" title="${file.filename || file.name}" style="text-align: left;">${file.filename || file.name}</a>`
                    : `<span class="file-name" style="text-align: left; display: inline-block;" title="${file.filename || file.name}">${file.filename || file.name}</span>`
                }</td>
                <td class="file-size" data-id="${file.id}" style="text-align: left;">${file.is_folder ? '计算中...' : formatSize(file.size)}</td>
                <td style="text-align: left;">${moment(file.created_at).format('YYYY-MM-DD HH:mm:ss')}</td>
                <td class="actions">
                    <div class="btn-group" role="group">
                        <button class="btn btn-sm btn-warning" onclick="showRenameModal(${file.id}, '${(file.filename || file.name).replace(/'/g, "\\'")}')">重命名</button>
                        <button class="btn btn-sm btn-info text-white" onclick="showMoveModal(${file.id})">移动</button>
                        <button class="btn btn-sm btn-danger" onclick="deleteFile(${file.id}, ${file.is_folder})">删除</button>
                        ${file.is_folder ? '' : `
                            ${showPreviewBtn ? `<button class="btn btn-sm btn-success" onclick="previewFile('${file.id}')"><i class="bi bi-eye"></i> 预览</button>` : ''}
                            <button class="btn btn-sm btn-primary" onclick="openTelegramFile('${file.id}')"><i class="bi bi-download"></i> 下载</button>
                        `}
                    </div>
                </td>
            `;
            
            // 添加文件夹链接点击事件
            const folderLink = tr.querySelector('.folder-link');
            if (folderLink) {
                folderLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    currentFolderId = folderLink.dataset.id;
                    currentPage = 1; // 重置为第一页
                    loadFiles();
                });
            }
            
            tbody.appendChild(tr);
        });
        
        // 等待所有文件夹大小计算完成并更新UI
        if (folderSizePromises.length > 0) {
            Promise.all(folderSizePromises.map(item => item.promise))
                .then(sizes => {
                    folderSizePromises.forEach((item, index) => {
                        const sizeCell = document.querySelector(`.file-size[data-id="${item.id}"]`);
                        if (sizeCell) {
                            sizeCell.textContent = formatSize(sizes[index]);
                        }
                    });
                })
                .catch(error => {
                    console.error('Error updating folder sizes:', error);
                });
        }
        
    } catch (error) {
        console.error('搜索出错:', error);
        showToast('搜索失败，请重试', 'error');
    }
}

// 初始化 tooltips
function initPopovers() {
    // 销毁所有现有的tooltips
    document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => {
        const tooltip = bootstrap.Tooltip.getInstance(el);
        if (tooltip) {
            tooltip.dispose();
        }
    });

    // 初始化新的tooltips
    document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => {
        const tooltip = new bootstrap.Tooltip(el, {
            html: true,
            placement: 'right',
            trigger: 'hover',
            delay: { show: 0, hide: 0 },
            template: '<div class="tooltip" role="tooltip" style="text-align: left !important;"><div class="tooltip-arrow"></div><div class="tooltip-inner" style="text-align: left !important; padding: 8px; max-width: none !important; width: auto !important;"></div></div>',
            popperConfig: function(defaultBsPopperConfig) {
                return {
                    ...defaultBsPopperConfig,
                    modifiers: [
                        ...(defaultBsPopperConfig.modifiers || []),
                        {
                            name: 'offset',
                            options: {
                                offset: [0, 0],
                            },
                        }
                    ]
                };
            }
        });
    });
}

// 显示重命名模态框
function showRenameModal(id, currentName) {
    FileManager.selectedItemId = id;
    const nameInput = document.getElementById('newName');
    nameInput.value = currentName;
    
    // 在模态框显示后聚焦到输入框并选中文本
    FileManager.renameModal._element.addEventListener('shown.bs.modal', () => {
        nameInput.focus();
        nameInput.select();
    }, { once: true });
    
    FileManager.renameModal.show();
}

// 执行重命名
async function renameItem() {
    const newName = document.getElementById('newName').value.trim();
    if (!newName) {
        showToast('请输入新名称', 'error');
        return;
    }
    
    try {
        const response = await fetch(`/api/files/${selectedItemId}/rename`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newName })
        });
        
        if (response.ok) {
            showToast('重命名成功');
            renameModal.hide();
            loadFiles();
        } else {
            const data = await response.json();
            showToast(data.error || '重命名失败', 'error');
        }
    } catch (error) {
        console.error('Rename error:', error);
        showToast('重命名失败', 'error');
    }
}

// 检查登录状态
async function checkLoginStatus() {
  try {
    const response = await fetch('/api/auth/status', {
      credentials: 'include'
    });
    
    if (!response.ok) {
      throw new Error('会话检查失败');
    }
    
    const data = await response.json();
    if (!data.loggedIn) {
      // 只有在当前页面不是登录页时才跳转
      if (!window.location.pathname.includes('login.html')) {
        window.location.href = '/login.html';
      }
      return false;
    }
    
    // 更新用户信息显示
    const userInfo = document.getElementById('userInfo');
    if (userInfo) {
      userInfo.textContent = `欢迎, ${data.user.username}`;
    }
    
    return true; // 返回登录状态
  } catch (error) {
    console.error('检查登录状态失败:', error);
    // 只有在当前页面不是登录页时才跳转
    if (!window.location.pathname.includes('login.html')) {
      window.location.href = '/login.html';
    }
    return false;
  }
}

// 打开Telegram文件
async function openTelegramFile(fileId) {
    try {
        // 获取文件信息
        const file = FileManager.allFiles.find(f => String(f.id) === String(fileId));
        if (!file) {
            throw new Error('文件不存在');
        }
        
        // 获取消息ID
        const messageId = file.message_id || (file.tg_file_id && file.tg_file_id.includes(':') ? file.tg_file_id.split(':')[1] : null);
        if (!messageId) {
            throw new Error('无法获取消息ID');
        }
        
        // 尝试构建电报链接（t.me或直接获取文件）
        const chatId = file.file_id && file.file_id.includes(':') ? file.file_id.split(':')[0] : null;
        if (chatId) {
            // 构建Telegram链接
            const url = `https://t.me/c/${chatId.replace('-100', '')}/${messageId}`;
            window.open(url, '_blank');
        } else {
            // 回退到直接下载
            const encodedFileName = encodeURIComponent(file.filename || file.name || '');
            window.open(`/proxy/${fileId}?original_name=${encodedFileName}`, '_blank');
        }
    } catch (error) {
        console.error('打开Telegram文件失败:', error);
        showToast('打开Telegram文件失败: ' + error.message, 'error');
    }
}

// 复制文本到剪贴板
function copyToClipboard(elementId) {
    const element = document.getElementById(elementId);
    element.select();
    element.setSelectionRange(0, 99999); // 对于移动设备
    
    try {
        document.execCommand('copy');
        showToast('已复制到剪贴板');
    } catch (err) {
        navigator.clipboard.writeText(element.value)
            .then(() => showToast('已复制到剪贴板'))
            .catch(err => {
                console.error('复制失败:', err);
                showToast('复制失败，请手动复制', 'error');
            });
    }
}

// 设置每页显示数量
function setPageSize(size) {
    window.FileManager.pageSize = parseInt(size);
    window.FileManager.currentPage = 1; // 重置到第一页
    loadFiles();
}

// 页面初始化函数
async function initPage() {
  try {
    console.log('页面初始化开始...');
    
    // 初始化FileManager对象
    window.FileManager = {
        currentFolderId: null,
        currentPage: 1,
        pageSize: 20,
        allFiles: [],
        filteredFiles: [],
        currentSortField: 'name',
        currentSortOrder: 'asc',
        folderSizeCache: {}
    };
    
    // 从本地存储中恢复页面大小设置
    const savedPageSize = localStorage.getItem('pageSize');
    if (savedPageSize) {
        FileManager.pageSize = parseInt(savedPageSize, 10);
        
        // 更新选择框的值
        const pageSizeSelect = document.getElementById('pageSize');
        if (pageSizeSelect) {
            pageSizeSelect.value = FileManager.pageSize;
        }
    }
    
    // 为页面大小选择器添加事件监听
    const pageSizeSelect = document.getElementById('pageSize');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', (e) => {
        setPageSize(e.target.value);
      });
    }
    
    // 添加搜索按钮和输入框的事件监听
    const searchButton = document.getElementById('fileSearchButton');
    const searchInput = document.getElementById('fileSearchInput');
    
    if (searchButton) {
      searchButton.addEventListener('click', searchFiles);
      console.log('搜索按钮事件已绑定');
    }
    
    if (searchInput) {
      searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          searchFiles();
        }
      });
      console.log('搜索输入框事件已绑定');
    }
    
    // 添加修改密码按钮事件监听
    const changePasswordBtn = document.getElementById('changePasswordBtn');
    if (changePasswordBtn) {
      changePasswordBtn.addEventListener('click', () => {
        const changePasswordModal = new bootstrap.Modal(document.getElementById('changePasswordModal'));
        changePasswordModal.show();
      });
      console.log('修改密码按钮事件已绑定');
    }
    
    // 添加退出登录按钮事件监听
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', logout);
      console.log('退出登录按钮事件已绑定');
    }
    
    // 添加保存密码按钮事件监听
    const savePasswordBtn = document.getElementById('savePasswordBtn');
    if (savePasswordBtn) {
      savePasswordBtn.addEventListener('click', changePassword);
      console.log('保存密码按钮事件已绑定');
    }
    
    // 先检查登录状态
    const isLoggedIn = await checkLoginStatus();
    
    if (!isLoggedIn) {
      console.log('用户未登录，不加载文件列表');
                return;
    }
    
    // 在主页时加载文件列表
    if (window.location.pathname.includes('index.html') || window.location.pathname === '/' || window.location.pathname === '') {
      console.log('页面初始化中，加载文件列表...');
      await loadFiles();
        }
    } catch (error) {
    console.error('页面初始化错误:', error);
    }
}

// 退出登录
async function logout() {
    try {
    console.log('执行退出登录操作');
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    // 只显示一次提示
    showToast('退出登录中...');
    
    // 清除Cookie
    document.cookie = 'session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    
    // 延迟跳转，让用户看到提示
    setTimeout(() => {
            window.location.href = '/login.html';
    }, 1000);
    } catch (error) {
    console.error('退出登录错误:', error);
    // 清除Cookie并跳转
    document.cookie = 'session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    window.location.href = '/login.html';
  }
}

// 修改密码
async function changePassword() {
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    
  // 检查密码是否符合要求
    if (!currentPassword) {
        showToast('请输入当前密码', 'error');
        return;
    }
    
    if (!newPassword) {
        showToast('请输入新密码', 'error');
        return;
    }
    
    if (newPassword !== confirmPassword) {
        showToast('两次输入的新密码不一致', 'error');
        return;
    }
    
  try {
    const response = await fetch('/api/auth/change-password', {
            method: 'POST',
      credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                currentPassword,
                newPassword
            })
        });
        
            const data = await response.json();
        
    if (response.ok) {
            showToast('密码修改成功');
      // 隐藏模态框
            const changePasswordModal = bootstrap.Modal.getInstance(document.getElementById('changePasswordModal'));
            changePasswordModal.hide();
      // 重置表单
      document.getElementById('changePasswordForm').reset();
        } else {
            showToast(data.error || '密码修改失败', 'error');
        }
    } catch (error) {
    console.error('修改密码错误:', error);
    showToast('修改密码失败，请重试', 'error');
  }
}

// 更新分页信息
function updatePagination(totalItems) {
    try {
        // 计算总页数
        FileManager.totalPages = Math.ceil(totalItems / FileManager.pageSize) || 1;
        
        // 确保当前页在有效范围内
        if (FileManager.currentPage > FileManager.totalPages) {
            FileManager.currentPage = FileManager.totalPages;
        } else if (FileManager.currentPage < 1) {
            FileManager.currentPage = 1;
        }
        
        // 根据是否需要分页来显示或隐藏分页控件
        const paginationElement = document.getElementById('pagination');
        
        if (!paginationElement) {
            console.warn('分页元素不存在');
            return;
        }

        const pageInfoElement = document.getElementById('pageInfo');
        
        if (totalItems > FileManager.pageSize) {
            // 显示分页控件
            paginationElement.style.cssText = 'display: block !important';
            if (pageInfoElement) {
                pageInfoElement.textContent = `${FileManager.currentPage} / ${FileManager.totalPages}`;
            }
            
            // 更新上一页和下一页按钮状态
            const prevButton = document.getElementById('prevPage');
            const nextButton = document.getElementById('nextPage');
            
            if (prevButton) {
                prevButton.parentElement.classList.toggle('disabled', FileManager.currentPage <= 1);
            }
            
            if (nextButton) {
                nextButton.parentElement.classList.toggle('disabled', FileManager.currentPage >= FileManager.totalPages);
            }
        } else {
            // 隐藏分页控件
            paginationElement.style.cssText = 'display: none !important';
        }
        
        console.log('分页信息已更新:', {
            currentPage: FileManager.currentPage,
            totalPages: FileManager.totalPages,
            pageSize: FileManager.pageSize,
            totalItems
        });
    } catch (error) {
        console.error('更新分页信息出错:', error);
    }
}

// 页面加载时执行初始化
let hasInitialized = false;
document.addEventListener('DOMContentLoaded', () => {
    if (!hasInitialized) {
        initPage();
        hasInitialized = true;
    }
});

// 定期检查登录状态（每5分钟）
setInterval(checkLoginStatus, 5 * 60 * 1000);

// 预览文件
async function previewFile(fileId) {
    try {
        console.log('预览文件，文件ID:', fileId, '类型:', typeof fileId);
        console.log('当前文件列表:', FileManager.allFiles);
        
        // 确保fileId是字符串类型
        const fileIdStr = String(fileId);
        
        // 获取文件信息
        const fileInfo = FileManager.allFiles.find(file => String(file.id) === fileIdStr);
        console.log('找到的文件信息:', fileInfo);
        
        if (!fileInfo) {
            // 尝试从服务器获取文件信息
            try {
                console.log('本地未找到文件信息，尝试从服务器获取');
                const response = await fetch(`/api/files/${fileIdStr}`);
                if (response.ok) {
                    const fileData = await response.json();
                    console.log('从服务器获取的文件信息:', fileData);
                    
                    // 构建预览URL
                    const encodedFileName = encodeURIComponent(fileData.filename || fileData.name || '');
                    let previewUrl;
                    
                    // 对于图片、音频和视频文件，使用代理
                    if (fileData.mime_type && (
                        fileData.mime_type.startsWith('image/') ||
                        fileData.mime_type.startsWith('audio/') ||
                        fileData.mime_type.startsWith('video/')
                    )) {
                        previewUrl = `/proxy/${fileIdStr}?original_name=${encodedFileName}`;
                        
                        // 对于图片，添加 Content-Disposition: inline
                        if (fileData.mime_type.startsWith('image/')) {
                            previewUrl += '&disposition=inline';
                        }
                        
                        // 对于音频和视频，使用 HTML5 播放器页面
                        if (fileData.mime_type.startsWith('audio/') || fileData.mime_type.startsWith('video/')) {
                            // 使用绝对路径，避免相对路径问题
                            const playerUrl = new URL(window.location.origin);
                            playerUrl.pathname = `/proxy/${fileIdStr}`;
                            playerUrl.search = `?player=1&original_name=${encodedFileName}`;
                            window.open(playerUrl.toString(), '_blank');
                            return;
                        }
                    } else {
                        // 对于其他类型的文件，直接使用原始路径
                        previewUrl = `/api/files/${fileIdStr}/download`;
                    }
                    
                    // 打开新窗口预览文件
                    window.open(previewUrl, '_blank');
                    return;
                }
            } catch (serverError) {
                console.error('从服务器获取文件信息失败:', serverError);
            }
            
            throw new Error('文件不存在');
        }
        
        // 构建预览URL
        const encodedFileName = encodeURIComponent(fileInfo.filename || fileInfo.name || '');
        let previewUrl;
        
        // 对于图片、音频和视频文件，使用代理
        if (fileInfo.mime_type && (
            fileInfo.mime_type.startsWith('image/') ||
            fileInfo.mime_type.startsWith('audio/') ||
            fileInfo.mime_type.startsWith('video/')
        )) {
            previewUrl = `/proxy/${fileIdStr}?original_name=${encodedFileName}`;
            
            // 对于图片，添加 Content-Disposition: inline
            if (fileInfo.mime_type.startsWith('image/')) {
                previewUrl += '&disposition=inline';
            }
            
            // 对于音频和视频，使用 HTML5 播放器页面
            if (fileInfo.mime_type.startsWith('audio/') || fileInfo.mime_type.startsWith('video/')) {
                // 使用绝对路径，避免相对路径问题
                const playerUrl = new URL(window.location.origin);
                playerUrl.pathname = `/proxy/${fileIdStr}`;
                playerUrl.search = `?player=1&original_name=${encodedFileName}`;
                window.open(playerUrl.toString(), '_blank');
                return;
            }
        } else {
            // 对于其他类型的文件，直接使用原始路径
            previewUrl = `/api/files/${fileIdStr}/download`;
        }
        
        // 打开新窗口预览文件
        window.open(previewUrl, '_blank');
    } catch (error) {
        console.error('预览文件失败:', error);
        alert('预览文件失败: ' + error.message);
    }
}

// 在文件上传成功后更新文件夹大小缓存
async function updateFolderSizeCache(folderId) {
    // 清除当前文件夹的缓存
    delete FileManager.folderSizeCache[folderId];
    
    // 清除所有父文件夹的缓存
    let currentId = folderId;
    while (currentId) {
        const parent = FileManager.allFiles.find(f => f.id === currentId);
        if (!parent || !parent.parent_id) break;
        currentId = parent.parent_id;
        delete FileManager.folderSizeCache[currentId];
    }
    
    // 重新计算当前文件夹大小
    await calculateFolderSize(folderId);
}

// 修改文件上传成功后的处理
if (FileManager.uploadSuccess) {
    showToast('所有文件上传成功');
    // 重新加载文件列表
    if (typeof loadFiles === 'function') {
        loadFiles().then(async () => {
            // 更新文件夹大小缓存
            await updateFolderSizeCache(FileManager.currentFolderId);
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
}
