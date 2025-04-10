let currentFolderId = null;
let selectedFileId = null;
let pendingDeleteId = null;
let pendingDeleteIsFolder = false;
let pendingBatchDeleteFiles = null;
let selectedItemId = null;
// 分页相关变量
let currentPage = 1;
let totalPages = 1;
let pageSize = 10;
let allFiles = []; // 存储当前文件夹中的所有文件
// 排序相关变量
let currentSortField = 'name';
let currentSortOrder = 'asc';

// 文件夹大小缓存
const folderSizeCache = {};

const newFolderModal = new bootstrap.Modal(document.getElementById('newFolderModal'));
const moveModal = new bootstrap.Modal(document.getElementById('moveModal'));
const batchMoveModal = new bootstrap.Modal(document.getElementById('batchMoveModal'));
const confirmDeleteModal = new bootstrap.Modal(document.getElementById('confirmDeleteModal'));
const renameModal = new bootstrap.Modal(document.getElementById('renameModal'));

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
        const allFiles = await response.json();
        const folders = allFiles.filter(f => f.is_folder);
        
        // 递归函数，用于构建路径
        function buildPath(id) {
            const folder = folders.find(f => f.id.toString() === id.toString());
            if (!folder) return [];
            
            if (folder.parent_id !== null) {
                const parentPath = buildPath(folder.parent_id);
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
    // 检查缓存中是否已有数据
    if (folderSizeCache[folderId] !== undefined) {
        return folderSizeCache[folderId];
    }
    
    try {
        const response = await fetch(`/api/folders/${folderId}/size`);
        if (!response.ok) {
            throw new Error('Failed to get folder size');
        }
        const data = await response.json();
        // 存入缓存
        folderSizeCache[folderId] = data.size;
        return data.size;
    } catch (error) {
        console.error('Error calculating folder size:', error);
        return 0;
    }
}

// 加载文件列表
async function loadFiles() {
    try {
        console.log('Loading files for folder:', currentFolderId);
        const response = await fetch(`/api/files?parent_id=${currentFolderId || ''}`);
        console.log('Files API response status:', response.status);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        allFiles = await response.json();
        console.log('Loaded files:', allFiles);
        
        // 更新面包屑
        const folderPath = await getFolderPath(currentFolderId);
        console.log('Current folder path:', folderPath);
        updateBreadcrumb(folderPath);
        
        // 应用分页
        renderFileList();
    } catch (error) {
        showToast('加载文件列表失败', 'error');
        console.error('Error loading files:', error);
    }
}

// 排序文件
function sortFiles(files, field = 'name', order = 'asc') {
    return [...files].sort((a, b) => {
        if (field === 'name') {
            // 名称排序逻辑
            const splitName = (name) => {
                // 拆分文件名与扩展名
                const lastDotIndex = name.lastIndexOf('.');
                if (lastDotIndex === -1) return { name, ext: '' };
                return {
                    name: name.slice(0, lastDotIndex),
                    ext: name.slice(lastDotIndex + 1)
                };
            };

            // 文件夹始终在文件前面
            if (a.is_folder !== b.is_folder) {
                return a.is_folder ? -1 : 1;
            }

            // 如果都是文件夹或都是文件，按名称排序
            const aNameParts = splitName(a.name);
            const bNameParts = splitName(b.name);
            
            // 如果是文件且扩展名不同，可以选择按扩展名排序
            if (!a.is_folder && !b.is_folder && aNameParts.ext !== bNameParts.ext) {
                return order === 'asc' ? 
                    aNameParts.ext.localeCompare(bNameParts.ext) : 
                    bNameParts.ext.localeCompare(aNameParts.ext);
            }
            
            // 按名称排序
            return order === 'asc' ? 
                a.name.localeCompare(b.name) : 
                b.name.localeCompare(a.name);
            
        } else if (field === 'size') {
            // 文件大小排序
            let aSize = a.size || 0;
            let bSize = b.size || 0;
            
            // 如果是文件夹，使用缓存的大小
            if (a.is_folder && folderSizeCache[a.id] !== undefined) {
                aSize = folderSizeCache[a.id];
            }
            if (b.is_folder && folderSizeCache[b.id] !== undefined) {
                bSize = folderSizeCache[b.id];
            }
            
            // 如果文件夹大小未缓存，尝试将文件夹排在最后或最前
            if (a.is_folder && folderSizeCache[a.id] === undefined) {
                return order === 'asc' ? -1 : 1;
            }
            if (b.is_folder && folderSizeCache[b.id] === undefined) {
                return order === 'asc' ? 1 : -1;
            }
            
            // 正常排序
            return order === 'asc' ? aSize - bSize : bSize - aSize;
            
        } else if (field === 'created_at') {
            const aDate = new Date(a.created_at);
            const bDate = new Date(b.created_at);
            return order === 'asc' ? aDate - bDate : bDate - aDate;
        }
        return 0;
    });
}

// 处理排序点击事件
function handleSort(field) {
    if (currentSortField === field) {
        // 如果点击的是当前排序字段，切换排序顺序
        currentSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
        } else {
        // 如果点击的是新字段，设置为升序
        currentSortField = field;
        currentSortOrder = 'asc';
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
    const th = document.querySelector(`th[data-sort="${currentSortField}"]`);
    if (th) {
        const icon = document.createElement('span');
        icon.className = 'sort-icon ms-1';
        icon.innerHTML = currentSortOrder === 'asc' ? '↑' : '↓';
        th.appendChild(icon);
    }
}

// 更新分页信息
function updatePagination(totalItems) {
    const pagination = document.getElementById('pagination');
    const pageInfo = document.getElementById('pageInfo');
    const prevPage = document.getElementById('prevPage');
    const nextPage = document.getElementById('nextPage');
    const pageSize = parseInt(document.getElementById('pageSize').value);
    
    // 计算总页数
    const totalPages = Math.ceil(totalItems / pageSize);
    
    // 更新分页信息
    pageInfo.textContent = `${currentPage} / ${totalPages}`;
    
    // 更新上一页按钮状态
    prevPage.classList.toggle('disabled', currentPage <= 1);
    prevPage.style.pointerEvents = currentPage <= 1 ? 'none' : 'auto';
    
    // 更新下一页按钮状态
    nextPage.classList.toggle('disabled', currentPage >= totalPages);
    nextPage.style.pointerEvents = currentPage >= totalPages ? 'none' : 'auto';
    
    // 显示或隐藏分页控件
    pagination.style.display = totalPages > 1 ? 'block' : 'none';
}

// 渲染文件列表（带分页）
async function renderFileList() {
    console.log('Rendering file list, total files:', allFiles.length);
    const tbody = document.getElementById('fileList');
    tbody.innerHTML = '';
    
    if (allFiles.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">当前文件夹为空</td></tr>';
        return;
    }
    
    // 事先计算所有文件夹的大小并存入缓存
    const folderSizePromises = allFiles
        .filter(file => file.is_folder)
        .map(folder => {
            if (folderSizeCache[folder.id] === undefined) {
                return calculateFolderSize(folder.id)
                    .then(size => {
                        folderSizeCache[folder.id] = size;
                        return { id: folder.id, size };
                    });
            }
            return Promise.resolve({ id: folder.id, size: folderSizeCache[folder.id] });
        });
    
    // 等待所有文件夹大小计算完成
    await Promise.all(folderSizePromises);
    
    // 应用排序
    const sortedFiles = sortFiles(allFiles, currentSortField, currentSortOrder);
    
    // 计算分页
    totalPages = Math.ceil(sortedFiles.length / pageSize);
    if (currentPage > totalPages && totalPages > 0) {
        currentPage = totalPages;
    }
    
    console.log('Pagination info:', {
        currentPage,
        totalPages,
        pageSize,
        totalFiles: sortedFiles.length
    });
    
    // 根据是否需要分页来显示或隐藏分页控件
    const paginationElement = document.getElementById('pagination');
    if (sortedFiles.length > pageSize) {
        paginationElement.style.cssText = 'display: block !important';
        document.getElementById('pageInfo').textContent = `${currentPage} / ${totalPages}`;
        
        // 更新上一页和下一页按钮状态
        const prevButton = document.getElementById('prevPage').parentElement;
        const nextButton = document.getElementById('nextPage').parentElement;
        
        prevButton.classList.toggle('disabled', currentPage <= 1);
        nextButton.classList.toggle('disabled', currentPage >= totalPages);
    } else {
        paginationElement.style.cssText = 'display: none !important';
    }
    
    // 计算当前页的文件范围
    const start = (currentPage - 1) * pageSize;
    const end = Math.min(start + pageSize, sortedFiles.length);
    const currentPageFiles = sortedFiles.slice(start, end);
    
    console.log('Current page files:', {
        start,
        end,
        filesCount: currentPageFiles.length,
        files: currentPageFiles
    });
    
    // 显示文件列表
    currentPageFiles.forEach((file, index) => {
        const actualIndex = start + index + 1;
        const tr = document.createElement('tr');
        
        let fileSize = file.size || 0;
        if (file.is_folder) {
            // 使用缓存的大小
            fileSize = folderSizeCache[file.id] !== undefined ? folderSizeCache[file.id] : 0;
        }
        
        tr.innerHTML = `
            <td><input type="checkbox" class="file-checkbox" value="${file.id}"></td>
            <td>${actualIndex}</td>
            <td style="text-align: left; padding-left: 8px;">${file.is_folder ? '📁 ' : '📄 '}${
                file.is_folder 
                ? `<a href="#" class="folder-link" data-id="${file.id}" style="text-align: left;">${file.name}</a>`
                : `<span class="file-name" style="text-align: left; display: inline-block;">${file.name}</span>`
            }</td>
            <td class="file-size" data-id="${file.id}" style="text-align: left;">${formatSize(fileSize)}</td>
            <td style="text-align: left;">${moment(file.created_at).format('YYYY-MM-DD HH:mm:ss')}</td>
            <td class="actions">
                <div class="btn-group" role="group">
                    <button class="btn btn-sm btn-warning" onclick="showRenameModal(${file.id}, '${file.name}')">重命名</button>
                    <button class="btn btn-sm btn-info text-white" onclick="showMoveModal(${file.id})">移动</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteFile(${file.id}, ${file.is_folder})">删除</button>
                    ${file.is_folder ? '' : `<button class="btn btn-sm btn-primary" onclick="openTelegramFile('${file.id}')">下载</button>`}
                </div>
            </td>
        `;
        
        // 添加文件夹点击事件
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
    
    // 更新分页信息
    updatePagination(sortedFiles.length);
    
    console.log('File list rendering completed');
    // 初始化新的 tooltips
    initPopovers();
    
    // 更新排序图标
    updateSortIcon();
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
    const folderNameInput = document.getElementById('folderName');
    folderNameInput.value = '';
    
    // 保存触发按钮的引用
    const triggerButton = document.activeElement;
    
    // 在模态框关闭时将焦点返回到触发按钮
    newFolderModal._element.addEventListener('hidden.bs.modal', function () {
        if (triggerButton && typeof triggerButton.focus === 'function') {
            setTimeout(() => triggerButton.focus(), 0);
        }
    }, { once: true });
    
    newFolderModal.show();
    
    // 模态框显示后自动聚焦到输入框
    newFolderModal._element.addEventListener('shown.bs.modal', () => {
        folderNameInput.focus();
    }, { once: true });
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
            body: JSON.stringify({ name, parentId: currentFolderId })
        });

        if (response.ok) {
            showToast('文件夹创建成功');
            newFolderModal.hide();
            currentPage = 1; // 创建新文件夹后回到第一页
            loadFiles();
        } else {
            showToast('文件夹创建失败', 'error');
            }
                } catch (error) {
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
        <span class="folder-name">📁 ${folder.name}</span>
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
        
        // 一次性获取所有文件
        const response = await fetch(`/api/files?all=true`);
        const allFiles = await response.json();
        
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
        // 获取所有文件
        const response = await fetch('/api/files?all=true');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const allFiles = await response.json();
        if (!Array.isArray(allFiles)) {
            throw new Error('返回的数据格式不正确');
        }
        
        // 过滤搜索结果，只显示文件夹
        const searchResults = allFiles.filter(file => 
            file.is_folder && file.name.toLowerCase().includes(searchTerm)
        );
        
        // 清空当前目录树
        folderTree.innerHTML = '';
        
        // 创建搜索结果容器
        const resultsContainer = document.createElement('div');
        resultsContainer.className = 'search-results';
        resultsContainer.innerHTML = '<h6 class="mb-3">搜索结果：</h6>';
        folderTree.appendChild(resultsContainer);
        
        // 显示搜索结果
        if (searchResults.length === 0) {
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
            for (const folder of searchResults) {
                // 检查是否可以移动到该文件夹
                let isDisabled = false;
                if (isBatch) {
                    // 批量移动逻辑
                    isDisabled = currentSelectedFiles.includes(folder.id) || 
                                currentSelectedFiles.some(id => 
                                    isSubfolderSync(folder.id, id, allFiles) || // 目标文件夹是当前文件夹的子孙文件夹
                                    isParentFolder(folder.id, id, allFiles)     // 目标文件夹是当前文件夹的父文件夹
                                );
                } else {
                    // 单个移动逻辑
                    isDisabled = selectedFileId === folder.id || 
                                isSubfolderSync(folder.id, selectedFileId, allFiles) || // 目标文件夹是当前文件夹的子孙文件夹
                                isParentFolder(folder.id, selectedFileId, allFiles);    // 目标文件夹是当前文件夹的父文件夹
                }
                
                const folderItem = document.createElement('div');
                folderItem.className = 'folder-item' + (isDisabled ? ' disabled' : '');
                folderItem.innerHTML = `
                    <input type="radio" name="${isBatch ? 'batch_target_folder' : 'target_folder'}" 
                           value="${folder.id}" 
                           id="search_folder_${folder.id}" 
                           ${isDisabled ? 'disabled' : ''}>
                    <span class="folder-name">📁 ${folder.name}</span>
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
    selectedFileId = fileId;
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
    
    moveModal._element.addEventListener('hidden.bs.modal', function () {
        if (triggerButton && typeof triggerButton.focus === 'function') {
            setTimeout(() => triggerButton.focus(), 0);
        }
        // 清理搜索框
        if (searchContainer && searchContainer.parentNode) {
            searchContainer.parentNode.removeChild(searchContainer);
        }
    }, { once: true });
    
    moveModal.show();
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
    
    batchMoveModal._element.addEventListener('hidden.bs.modal', function () {
        if (triggerButton && typeof triggerButton.focus === 'function') {
            setTimeout(() => triggerButton.focus(), 0);
        }
        // 清理搜索框
        if (searchContainer && searchContainer.parentNode) {
            searchContainer.parentNode.removeChild(searchContainer);
        }
    }, { once: true });
    
    batchMoveModal.show();
}

// 移动文件
async function moveFile() {
    const selectedFolder = document.querySelector('input[name="target_folder"]:checked');
    if (!selectedFolder) {
        showToast('请选择目标文件夹', 'error');
        return;
    }
    
    try {
        const response = await fetch(`/api/files/${selectedFileId}/move`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newParentId: selectedFolder.value === 'null' ? null : selectedFolder.value })
        });

        if (response.ok) {
            showToast('移动成功');
            moveModal.hide();
            // 如果当前页将没有内容了，且不是第一页，则回到上一页
            if (allFiles.length <= pageSize && currentPage > 1) {
                currentPage--;
            }
            loadFiles();
        } else {
            showToast('移动失败', 'error');
        }
    } catch (error) {
        showToast('移动失败', 'error');
    }
}

// 删除文件或文件夹
async function deleteFile(id, isFolder) {
    // 存储待删除的ID和类型
    pendingDeleteId = id;
    pendingDeleteIsFolder = isFolder;
    
    // 根据类型设置不同的确认消息
    const confirmMessage = isFolder 
        ? '此操作将递归删除文件夹下的所有文件，是否继续？'
        : '确定要删除此文件吗？';
    
    // 设置确认消息
    document.getElementById('confirmDeleteMessage').textContent = confirmMessage;
    
    // 显示确认对话框
    confirmDeleteModal.show();
}

// 实际执行删除操作
async function performDelete() {
    // 单个文件删除
    if (pendingDeleteId !== null) {
        try {
            const response = await fetch(`/api/files/${pendingDeleteId}`, {
                method: 'DELETE'
        });

        if (response.ok) {
                showToast('删除成功');
                // 如果当前页没有内容了，且不是第一页，则回到上一页
                if (allFiles.length <= pageSize && currentPage > 1) {
                    currentPage--;
                }
                loadFiles();
        } else {
                showToast('删除失败', 'error');
        }
    } catch (error) {
            showToast('删除失败', 'error');
            console.error('Delete error:', error);
        }
        
        // 重置待删除项
        pendingDeleteId = null;
        pendingDeleteIsFolder = false;
    }
    // 批量删除
    else if (pendingBatchDeleteFiles !== null) {
        let success = true;
        for (const id of pendingBatchDeleteFiles) {
            try {
                const response = await fetch(`/api/files/${id}`, {
                    method: 'DELETE'
                });
                if (!response.ok) {
                    success = false;
                }
            } catch (error) {
                success = false;
                console.error('Batch delete error:', error);
            }
        }
        
        if (success) {
            showToast('批量删除成功');
    } else {
            showToast('部分文件删除失败', 'error');
        }
        
        // 如果当前页将没有内容了，且不是第一页，则回到上一页
        const remainingCount = allFiles.length - pendingBatchDeleteFiles.length;
        const currentPageStart = (currentPage - 1) * pageSize;
        if (remainingCount <= currentPageStart && currentPage > 1) {
            currentPage--;
        }
        
        loadFiles();
        
        // 重置待删除项
        pendingBatchDeleteFiles = null;
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
    pendingBatchDeleteFiles = selectedFiles;
    
    // 设置确认消息
    document.getElementById('confirmDeleteMessage').textContent = 
        `确定要删除选中的 ${selectedFiles.length} 个文件/文件夹吗？`;
    
    // 显示确认对话框
    confirmDeleteModal.show();
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
    const modalBody = batchMoveModal._element.querySelector('.modal-body');
    modalBody.appendChild(progressContainer);
    
    // 禁用确认按钮
    const confirmBtn = batchMoveModal._element.querySelector('.modal-footer .btn-primary');
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
        batchMoveModal.hide();
        
        // 如果当前页将没有内容了，且不是第一页，则回到上一页
        const remainingCount = allFiles.length - selectedFiles.length;
        const currentPageStart = (currentPage - 1) * pageSize;
        if (remainingCount <= currentPageStart && currentPage > 1) {
            currentPage--;
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
        
        const allFiles = await response.json();
        const filteredFiles = allFiles.filter(file => 
            file.name.toLowerCase().includes(searchTerm)
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
                    ? `<a href="#" class="folder-link" data-id="${file.id}" style="text-align: left;">${file.name}</a>`
                    : `<span class="file-name" style="text-align: left; display: inline-block;">${file.name}</span>`
                }</td>
                <td class="file-size" data-id="${file.id}" style="text-align: left;">${file.is_folder ? '计算中...' : formatSize(file.size)}</td>
                <td style="text-align: left;">${moment(file.created_at).format('YYYY-MM-DD HH:mm:ss')}</td>
                <td class="actions">
                    <div class="btn-group" role="group">
                        <button class="btn btn-sm btn-warning" onclick="showRenameModal(${file.id}, '${file.name}')">重命名</button>
                        <button class="btn btn-sm btn-info text-white" onclick="showMoveModal(${file.id})">移动</button>
                        <button class="btn btn-sm btn-danger" onclick="deleteFile(${file.id}, ${file.is_folder})">删除</button>
                        ${file.is_folder ? '' : `<button class="btn btn-sm btn-primary" onclick="openTelegramFile('${file.id}')">下载</button>`}
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
    selectedItemId = id;
    const nameInput = document.getElementById('newName');
    nameInput.value = currentName;
    
    // 在模态框显示后聚焦到输入框并选中文本
    renameModal._element.addEventListener('shown.bs.modal', () => {
        nameInput.focus();
        nameInput.select();
    }, { once: true });
    
    renameModal.show();
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

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    loadFiles();
    
    // 获取当前用户信息
    fetchCurrentUser();
    
    // 添加搜索按钮点击事件
    document.getElementById('fileSearchButton').addEventListener('click', searchFiles);
    
    // 添加搜索输入框回车事件
    document.getElementById('fileSearchInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            // 触发搜索
            searchFiles();
        }
    });
    
    // 文件夹树点击事件
    document.querySelectorAll('#folderTree, #batchFolderTree').forEach(tree => {
        tree.addEventListener('click', (e) => {
            if (e.target.classList.contains('folder-item')) {
                const container = e.target.closest('#folderTree, #batchFolderTree');
                container.querySelectorAll('.folder-item').forEach(item => item.classList.remove('selected'));
                e.target.classList.add('selected');
            }
        });
    });

    // 添加新建文件夹输入框的回车事件监听
    document.getElementById('folderName').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            createFolder();
        }
    });
    
    // 添加确认删除按钮的点击事件
    document.getElementById('confirmDeleteBtn').addEventListener('click', () => {
        confirmDeleteModal.hide();
        performDelete();
    });
    
    // 添加退出登录按钮点击事件
    document.getElementById('logoutBtn').addEventListener('click', logout);
    
    // 添加修改密码按钮点击事件
    document.getElementById('changePasswordBtn').addEventListener('click', showChangePasswordModal);
    
    // 添加保存密码按钮点击事件
    document.getElementById('savePasswordBtn').addEventListener('click', changePassword);
    
    // 分页控件事件监听
    document.getElementById('prevPage').addEventListener('click', (e) => {
        e.preventDefault();
        if (currentPage > 1) {
            currentPage--;
            renderFileList();
        }
    });
    
    document.getElementById('nextPage').addEventListener('click', (e) => {
        e.preventDefault();
        if (currentPage < totalPages) {
            currentPage++;
            renderFileList();
        }
    });
    
    // 每页显示数量变更事件
    document.getElementById('pageSize').addEventListener('change', (e) => {
        pageSize = parseInt(e.target.value);
        currentPage = 1; // 重置为第一页
        renderFileList();
        
        // 保存用户偏好到localStorage
        try {
            localStorage.setItem('fileManagerPageSize', pageSize);
        } catch (e) {
            console.error('Failed to save page size preference:', e);
        }
    });
    
    // 从localStorage加载用户偏好的每页显示数量
    try {
        const savedPageSize = localStorage.getItem('fileManagerPageSize');
        if (savedPageSize) {
            pageSize = parseInt(savedPageSize);
            document.getElementById('pageSize').value = pageSize;
        }
    } catch (e) {
        console.error('Failed to load page size preference:', e);
    }

    // 添加重命名输入框的回车事件监听
    document.getElementById('newName').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            renameItem();
        }
    });

    // 添加操作按钮区域左右滑动的增强功能
    document.addEventListener('DOMContentLoaded', function() {
        // 获取操作按钮容器
        const actionButtonsContainer = document.querySelector('.action-buttons-container');
        
        if (actionButtonsContainer) {
            // 检测是否在移动设备上
            const isMobile = window.innerWidth <= 768;
            
            if (isMobile) {
                // 添加视觉提示，指示该区域可以滚动
                const indicator = document.createElement('div');
                indicator.className = 'scroll-indicator';
                indicator.innerHTML = '<span>← 滑动查看更多 →</span>';
                indicator.style.cssText = 'text-align: center; font-size: 0.8rem; color: #6c757d; margin-top: 4px; opacity: 0.8;';
                
                // 将指示器添加到容器之后
                actionButtonsContainer.parentNode.insertBefore(indicator, actionButtonsContainer.nextSibling);
                
                // 3秒后淡出提示
                setTimeout(() => {
                    indicator.style.transition = 'opacity 0.5s ease';
                    indicator.style.opacity = '0';
                    setTimeout(() => {
                        indicator.remove();
                    }, 500);
                }, 3000);
            }
            
            // 优化触摸滚动体验
            let isDown = false;
            let startX;
            let scrollLeft;
            
            actionButtonsContainer.addEventListener('mousedown', (e) => {
                isDown = true;
                actionButtonsContainer.style.cursor = 'grabbing';
                startX = e.pageX - actionButtonsContainer.offsetLeft;
                scrollLeft = actionButtonsContainer.scrollLeft;
            });
            
            actionButtonsContainer.addEventListener('mouseleave', () => {
                isDown = false;
                actionButtonsContainer.style.cursor = 'grab';
            });
            
            actionButtonsContainer.addEventListener('mouseup', () => {
                isDown = false;
                actionButtonsContainer.style.cursor = 'grab';
            });
            
            actionButtonsContainer.addEventListener('mousemove', (e) => {
                if (!isDown) return;
                e.preventDefault();
                const x = e.pageX - actionButtonsContainer.offsetLeft;
                const walk = (x - startX) * 2; // 滚动速度
                actionButtonsContainer.scrollLeft = scrollLeft - walk;
            });

            // 添加触摸事件支持
            actionButtonsContainer.addEventListener('touchstart', (e) => {
                const touch = e.touches[0];
                startX = touch.pageX - actionButtonsContainer.offsetLeft;
                scrollLeft = actionButtonsContainer.scrollLeft;
            }, { passive: true });

            actionButtonsContainer.addEventListener('touchmove', (e) => {
                if (e.touches.length !== 1) return;
                const touch = e.touches[0];
                const x = touch.pageX - actionButtonsContainer.offsetLeft;
                const walk = (x - startX) * 2;
                actionButtonsContainer.scrollLeft = scrollLeft - walk;
                
                // 注意：在某些浏览器中，preventDefault可能不起作用，因为passive默认为true
                // 我们可以通过CSS来防止父元素滚动：touch-action: pan-x
            }, { passive: true });

            // 添加可视指示器，显示可滚动区域的宽度
            const addScrollIndicator = () => {
                // 移除现有的滚动指示器（如果有）
                const existingScrollbar = document.querySelector('.custom-scrollbar');
                if (existingScrollbar) {
                    existingScrollbar.remove();
                }
                
                // 只在窗口宽度小于992px时添加滚动指示器（移动端和平板）
                const isMobileOrTablet = window.innerWidth < 992;
                
                // 检查是否需要滚动
                const needsScroll = actionButtonsContainer.scrollWidth > actionButtonsContainer.clientWidth;
                
                if (needsScroll && isMobileOrTablet) {
                    // 创建滚动指示器
                    const scrollbar = document.createElement('div');
                    scrollbar.className = 'custom-scrollbar';
                    scrollbar.style.cssText = `
                        height: 3px;
                        background-color: #f0f0f0;
                        border-radius: 3px;
                        margin-top: 4px;
                        margin-bottom: 8px;
                        position: relative;
                        width: 100%;
                        display: block; /* 确保显示 */
                    `;
                    
                    const thumb = document.createElement('div');
                    thumb.className = 'custom-scrollbar-thumb';
                    
                    // 计算thumb的宽度和位置
                    const ratio = actionButtonsContainer.clientWidth / actionButtonsContainer.scrollWidth;
                    thumb.style.cssText = `
                        height: 100%;
                        background-color: #aaa;
                        border-radius: 3px;
                        position: absolute;
                        left: 0;
                        width: ${ratio * 100}%;
                        transition: transform 0.1s ease;
                    `;
                    
                    scrollbar.appendChild(thumb);
                    actionButtonsContainer.parentNode.insertBefore(scrollbar, actionButtonsContainer.nextSibling);
                    
                    // 更新滚动条位置
                    actionButtonsContainer.addEventListener('scroll', () => {
                        const scrollRatio = actionButtonsContainer.scrollLeft / (actionButtonsContainer.scrollWidth - actionButtonsContainer.clientWidth);
                        const maxTranslate = scrollbar.clientWidth - thumb.clientWidth;
                        thumb.style.transform = `translateX(${scrollRatio * maxTranslate}px)`;
                    });
                }
            };

            // 在DOM加载完成后添加滚动指示器
            addScrollIndicator();

            // 在窗口大小改变时重新计算
            window.addEventListener('resize', () => {
                // 使用防抖处理，避免频繁触发
                if (window.resizeTimeout) {
                    clearTimeout(window.resizeTimeout);
                }
                window.resizeTimeout = setTimeout(() => {
                    addScrollIndicator();
                }, 200);
            });
        }
    });
});

// 获取当前用户信息
async function fetchCurrentUser() {
    try {
        const response = await fetch('/api/user');
        
        if (!response.ok) {
            // 如果未登录，跳转到登录页
            if (response.status === 401) {
                window.location.href = '/login.html';
                return;
            }
            throw new Error('Failed to fetch user info');
        }
        
        const userData = await response.json();
        
        // 显示用户名
        const usernameElement = document.getElementById('currentUsername');
        if (usernameElement && userData.username) {
            usernameElement.textContent = userData.username + ' ';
        }
        
        // 用户已登录，显示内容
        document.getElementById('loadingOverlay').style.display = 'none';
        document.getElementById('mainContent').style.display = 'block';
        
        // 加载文件列表
        await loadFiles();
    } catch (error) {
        console.error('Error fetching user info:', error);
        // 发生错误时也跳转到登录页
        window.location.href = '/login.html';
    }
}

// 退出登录
async function logout() {
    try {
        const response = await fetch('/api/logout', {
            method: 'POST'
        });
        
        if (response.ok) {
            window.location.href = '/login.html';
        } else {
            showToast('退出失败，请重试', 'error');
        }
    } catch (error) {
        console.error('Logout error:', error);
        showToast('退出失败，请重试', 'error');
    }
}

// 显示修改密码模态框
function showChangePasswordModal() {
    // 重置表单
    document.getElementById('changePasswordForm').reset();
    
    // 显示模态框
    const changePasswordModal = new bootstrap.Modal(document.getElementById('changePasswordModal'));
    changePasswordModal.show();
}

// 修改密码
async function changePassword() {
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    
    // 验证密码
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
    
    // 禁用按钮防止重复提交
    const saveBtn = document.getElementById('savePasswordBtn');
    const originalText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> 保存中...';
    
    try {
        const response = await fetch('/api/change-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                currentPassword,
                newPassword
            })
        });
        
            const data = await response.json();
        
        if (response.ok && data.success) {
            showToast('密码修改成功');
            const changePasswordModal = bootstrap.Modal.getInstance(document.getElementById('changePasswordModal'));
            changePasswordModal.hide();
        } else {
            showToast(data.error || '密码修改失败', 'error');
        }
    } catch (error) {
        console.error('Error changing password:', error);
        showToast('密码修改失败，请稍后重试', 'error');
    } finally {
        // 恢复按钮状态
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalText;
    }
}

// 打开Telegram文件
function openTelegramFile(fileId) {
    if (!fileId) {
        showToast('无效的文件链接', 'error');
        return;
    }

    // 在新窗口中打开下载链接
    window.open(`/api/files/download/${fileId}`, '_blank');
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