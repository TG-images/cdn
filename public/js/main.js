window.FileManager = window.FileManager || {
    allFiles: [],
    filteredFiles: [],
    folderSizeCache: {},
    calculatingSizes: new Set(),
    currentPage: 1,
    pageSize: 10,
    sortField: 'name',
    sortOrder: 'asc',
    selectedFiles: new Set(),
    currentFolderId: null,
    currentPath: '',
    modals: {},
    uploadSuccess: false,
    // 性能优化参数
    sizeCalculationBatch: 3, // 每批计算的文件夹数量
    sizeCalculationDelay: 200, // 批次间延迟(毫秒)
    pendingSizeCalculations: [],
    // 保留原有属性
    selectedFileId: null,
    pendingDeleteId: null,
    pendingDeleteIsFolder: false,
    pendingBatchDeleteFiles: null,
    selectedItemId: null,
    totalPages: 1,
    currentSortField: 'name',
    currentSortOrder: 'asc',
    pendingFolderSizeRequests: {}
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
        // 获取模态框元素
        const newFolderModalEl = document.getElementById('newFolderModal');
        const moveModalEl = document.getElementById('moveModal');
        const batchMoveModalEl = document.getElementById('batchMoveModal');
        const confirmDeleteModalEl = document.getElementById('confirmDeleteModal');
        const renameModalEl = document.getElementById('renameModal');
        const previewModalEl = document.getElementById('previewModal');
        const changePasswordModalEl = document.getElementById('changePasswordModal');

        // 检查元素是否存在并初始化
        if (newFolderModalEl && !FileManager.modals.newFolderModal) {
            FileManager.modals.newFolderModal = new bootstrap.Modal(newFolderModalEl);
        }
        if (moveModalEl && !FileManager.modals.moveModal) {
            FileManager.modals.moveModal = new bootstrap.Modal(moveModalEl);
        }
        if (batchMoveModalEl && !FileManager.modals.batchMoveModal) {
            FileManager.modals.batchMoveModal = new bootstrap.Modal(batchMoveModalEl);
        }
        if (confirmDeleteModalEl && !FileManager.modals.confirmDeleteModal) {
            FileManager.modals.confirmDeleteModal = new bootstrap.Modal(confirmDeleteModalEl);
            
            // 添加取消事件监听器
            confirmDeleteModalEl.addEventListener('hidden.bs.modal', function () {
                // 重置删除状态
                FileManager.pendingDeleteId = null;
                FileManager.pendingBatchDeleteFiles = null;
                console.log('删除模态框已关闭，重置删除状态');
            });
            
            // 确保确认删除按钮可以点击
            const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
            if (confirmDeleteBtn) {
                confirmDeleteBtn.disabled = false;
                console.log('确认删除按钮已启用');
            }
        }
        if (renameModalEl && !FileManager.modals.renameModal) {
            FileManager.modals.renameModal = new bootstrap.Modal(renameModalEl);
        }
        if (previewModalEl && !FileManager.modals.previewModal) {
            FileManager.modals.previewModal = new bootstrap.Modal(previewModalEl);
        }
        if (changePasswordModalEl && !FileManager.modals.changePasswordModal) {
            FileManager.modals.changePasswordModal = new bootstrap.Modal(changePasswordModalEl);
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
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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
            // 如果正在计算中，等待计算完成
            return new Promise((resolve) => {
                const checkCache = () => {
                    if (FileManager.folderSizeCache[folderId] !== undefined) {
                        resolve(FileManager.folderSizeCache[folderId]);
                    } else if (!FileManager.calculatingSizes.has(folderId)) {
                        resolve(0); // 如果计算已结束但缓存中没有值，返回0
                    } else {
                        setTimeout(checkCache, 100); // 等待100毫秒后再次检查
                    }
                };
                setTimeout(checkCache, 100);
            });
        }

        FileManager.calculatingSizes.add(folderId);

        // 尝试使用API获取文件夹大小
        try {
            const response = await fetch(`/api/folders/${folderId}/size`);
            if (response.ok) {
                const data = await response.json();
                const size = data.size || 0;
                
                // 更新缓存
                FileManager.folderSizeCache[folderId] = size;
                FileManager.calculatingSizes.delete(folderId);
                
                return size;
            }
        } catch (error) {
            console.warn('通过API获取文件夹大小失败，将使用本地计算:', error);
        }
        
        // 如果API获取失败，使用本地计算方法
        const size = await calculateFolderSizeLocally(folderId);
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
    return new Promise((resolve, reject) => {
        try {
            // 检查缓存
            if (FileManager.folderSizeCache[folderId] !== undefined) {
                return resolve(FileManager.folderSizeCache[folderId]);
            }
            
            // 使用深度优先搜索递归计算
            let totalSize = 0;
            const processedFolders = new Set(); // 防止循环引用导致的无限递归
            
            function dfs(folder_id) {
                if (processedFolders.has(folder_id)) {
                    return; // 避免重复处理同一文件夹
                }
                processedFolders.add(folder_id);
                
                // 获取当前文件夹的直接子文件和子文件夹
                const children = FileManager.allFiles.filter(file => file.parent_id === folder_id);
                let folderSize = 0;
                
                for (const child of children) {
                    if (child.is_folder) {
                        // 如果子文件夹已有缓存，直接使用
                        if (FileManager.folderSizeCache[child.id] !== undefined) {
                            folderSize += FileManager.folderSizeCache[child.id];
                        } else {
                            // 递归计算子文件夹大小
                            dfs(child.id);
                            // 递归完成后，从缓存中获取计算后的大小
                            folderSize += FileManager.folderSizeCache[child.id] || 0;
                        }
                    } else {
                        // 累加文件大小
                        folderSize += parseInt(child.file_size || child.size || 0, 10);
                    }
                }
                
                // 更新当前文件夹的缓存
                FileManager.folderSizeCache[folder_id] = folderSize;
                // 累加到总大小
                totalSize += folderSize;
            }
            
            dfs(folderId);
            
            // 更新缓存
            FileManager.folderSizeCache[folderId] = totalSize;
            
            resolve(totalSize);
        } catch (error) {
            console.error('本地计算文件夹大小失败:', error);
            reject(error);
        }
    });
}

// 加载文件列表
async function loadFiles(path = '') {
    try {
        console.log('开始加载文件列表:', { path, currentFolderId: FileManager.currentFolderId });
        
        // 如果 path 是数字或字符串形式的数字，则将其转换为文件夹 ID
        if (path && !isNaN(path)) {
            FileManager.currentFolderId = path;
        } else if (path === 'null' || path === null) {
            FileManager.currentFolderId = null;
        }
        
        // 显示加载状态
        const fileList = document.getElementById('fileList');
        if (!fileList) {
            throw new Error('找不到文件列表元素');
        }
        
        fileList.innerHTML = '<tr><td colspan="6" class="text-center"><div class="p-3"><i class="bi bi-arrow-clockwise"></i> 加载中...</div></td></tr>';
        
        // 获取文件列表
        const response = await fetch(`/api/files?parent_id=${FileManager.currentFolderId || ''}`);
        console.log('API响应状态:', response.status);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('API返回数据:', data);
        
        if (!data.success) {
            throw new Error(data.error || '获取文件列表失败');
        }

        // 保存所有文件数据，确保正确处理file_id和message_id
        FileManager.allFiles = data.files.map(file => {
            // 确保所有必要的字段都存在
            const processedFile = {
                id: file.id,
                filename: file.filename || file.name || '未命名',
                file_id: file.file_id || file.tg_file_id, // 兼容两种字段名
                message_id: file.message_id,
                parent_id: file.parent_id,
                is_folder: file.is_folder || false,
                size: parseInt(file.file_size || 0, 10),
                mime_type: file.mime_type,
                created_at: file.created_at
            };

            // 如果file_id包含message_id信息，提取出来
            if (processedFile.file_id && processedFile.file_id.includes(':') && !processedFile.message_id) {
                processedFile.message_id = processedFile.file_id.split(':')[1];
            }

            console.log('处理后的文件信息:', processedFile);
            return processedFile;
        });

        // 初始化过滤后的文件列表
        FileManager.filteredFiles = [...FileManager.allFiles];
        
        // 应用当前的排序
        if (FileManager.sortField && FileManager.sortOrder) {
            FileManager.filteredFiles = sortFiles(FileManager.filteredFiles, FileManager.sortField, FileManager.sortOrder);
        }

        // 更新当前路径
        FileManager.currentPath = path;
        
        // 获取文件夹路径
        let folderPath = [];
        if (FileManager.currentFolderId) {
            folderPath = await getFolderPath(FileManager.currentFolderId);
        }
        
        // 更新面包屑导航
        updateBreadcrumb(folderPath);
        
        // 渲染文件列表
        renderFileList();
        
        // 更新文件统计信息
        updateFileStats();
        
        console.log('文件列表加载完成:', {
            totalFiles: FileManager.allFiles.length,
            filteredFiles: FileManager.filteredFiles.length,
            currentPath: path
        });
        
        // 更新文件列表后，如果标记了上传成功，更新当前文件夹的大小缓存
        if (FileManager.uploadSuccess) {
            FileManager.uploadSuccess = false;
            await updateFolderCache(FileManager.currentFolderId);
        }
        
    } catch (error) {
        console.error('加载文件列表失败:', error);
        if (fileList) {
            fileList.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center text-danger">
                        <div class="p-3">
                            <i class="bi bi-exclamation-triangle me-2"></i>
                            加载文件列表失败: ${error.message}
                        </div>
                    </td>
                </tr>`;
        }
        showToast(`加载文件列表失败: ${error.message}`, 'error');
    }
}

// 修改排序函数
function sortFiles(files, sortBy, sortDirection) {
    return [...files].sort((a, b) => {
        // 总是将文件夹排在前面
        if (a.is_folder && !b.is_folder) return -1;
        if (!a.is_folder && b.is_folder) return 1;
        
        let valA, valB;
        
        if (sortBy === 'name') {
            valA = (a.name || a.filename || '').toLowerCase();
            valB = (b.name || b.filename || '').toLowerCase();
        } else if (sortBy === 'created_at') {
            valA = new Date(a.created_at || a.modifiedAt || 0).getTime();
            valB = new Date(b.created_at || b.modifiedAt || 0).getTime();
        } else if (sortBy === 'size') {
            if (a.is_folder) {
                valA = FileManager.folderSizeCache[a.id] || 0;
            } else {
                valA = parseInt(a.file_size || a.size || 0, 10);
            }
            
            if (b.is_folder) {
                valB = FileManager.folderSizeCache[b.id] || 0;
            } else {
                valB = parseInt(b.file_size || b.size || 0, 10);
            }
        } else {
            valA = a[sortBy] || 0;
            valB = b[sortBy] || 0;
        }
        
        // 根据排序方向返回比较结果
        if (sortDirection === 'asc') {
            return valA > valB ? 1 : -1;
        } else {
            return valA < valB ? 1 : -1;
        }
    });
}

// 处理排序点击事件
function handleSort(field) {
    let sortDirection;
    
    // 如果当前已经按此字段排序，则切换排序方向
    if (field === FileManager.currentSortField) {
        sortDirection = FileManager.currentSortOrder === 'asc' ? 'desc' : 'asc';
    } else {
        // 如果是新的排序字段，默认使用升序
        sortDirection = 'asc';
    }
    
    // 更新排序状态
    FileManager.currentSortField = field;
    FileManager.currentSortOrder = sortDirection;
    
    // 排序并重新渲染
    FileManager.filteredFiles = sortFiles(FileManager.filteredFiles, field, sortDirection);
    renderFileList();
    
    // 更新排序图标
    updateSortIcon();
}

// 更新排序图标
function updateSortIcon() {
    try {
        // 移除所有排序图标
        document.querySelectorAll('th.sortable .sort-icon').forEach(icon => {
            icon.remove();
        });
        
        // 找到当前排序的列
        const sortedHeader = document.querySelector(`th.sortable[data-sort="${FileManager.currentSortField}"]`);
        if (!sortedHeader) return;
        
        // 创建排序图标
        const sortIcon = document.createElement('span');
        sortIcon.className = 'sort-icon ms-1';
        sortIcon.innerHTML = FileManager.currentSortOrder === 'asc' ? '↑' : '↓';
        
        // 添加到表头
        sortedHeader.appendChild(sortIcon);
    } catch (error) {
        console.error('更新排序图标出错:', error);
    }
}

// 渲染文件列表
function renderFileList() {
    const fileList = document.getElementById('fileList');
    fileList.innerHTML = '';
    
    if (!FileManager.filteredFiles || FileManager.filteredFiles.length === 0) {
        const emptyRow = document.createElement('tr');
        emptyRow.innerHTML = '<td colspan="6" class="text-center">没有文件或文件夹</td>';
        fileList.appendChild(emptyRow);
        return;
    }
    
    // 获取当前页码和每页显示数量
    const currentPage = FileManager.currentPage || 1;
    const pageSize = parseInt(document.getElementById('pageSize').value) || 10;
    
    // 计算分页
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, FileManager.filteredFiles.length);
    const pageFiles = FileManager.filteredFiles.slice(startIndex, endIndex);
    
    // 清空待计算队列
    FileManager.pendingSizeCalculations = [];
    
    // 渲染文件列表
    pageFiles.forEach((file, index) => {
        const row = document.createElement('tr');
        
        // 添加复选框单元格
        const checkboxCell = document.createElement('td');
        checkboxCell.className = 'col-checkbox';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'file-checkbox';
        checkbox.value = file.id;
        checkboxCell.appendChild(checkbox);
        row.appendChild(checkboxCell);
        
        // 添加序号单元格
        const numberCell = document.createElement('td');
        numberCell.className = 'col-number';
        numberCell.textContent = startIndex + index + 1;
        row.appendChild(numberCell);
        
        // 名称单元格
        const nameCell = document.createElement('td');
        nameCell.className = 'col-name';
        
        // 创建一个包含图标和文件名的div容器
        const nameContainer = document.createElement('div');
        nameContainer.className = 'd-flex align-items-center';
        
        // 添加图标
        const iconSpan = document.createElement('span');
        iconSpan.className = 'me-2';
        if (file.is_folder) {
            iconSpan.innerHTML = '<i class="bi bi-folder-fill text-warning"></i>';
        } else {
            iconSpan.innerHTML = '<i class="bi bi-file-earmark-fill text-primary"></i>';
        }
        nameContainer.appendChild(iconSpan);
        
        // 添加文件名（文件夹保持链接，文件取消链接）
        if (file.is_folder) {
            const nameLink = document.createElement('a');
            nameLink.href = '#';
            nameLink.textContent = file.name || file.filename;
            nameLink.className = 'file-name-cell';
            nameLink.setAttribute('data-full-name', file.name || file.filename);
            nameLink.title = file.name || file.filename; // 添加title属性
            nameLink.onclick = function(e) {
                e.preventDefault();
                loadFiles(file.id);
            };
            nameContainer.appendChild(nameLink);
            
            // 检查文件名是否被截断
            setTimeout(() => {
                if (nameLink.scrollWidth > nameLink.clientWidth) {
                    nameLink.classList.add('truncated');
                }
            }, 0);
        } else {
            const nameSpan = document.createElement('span');
            nameSpan.textContent = file.name || file.filename;
            nameSpan.className = 'file-name-cell';
            nameSpan.setAttribute('data-full-name', file.name || file.filename);
            nameSpan.title = file.name || file.filename; // 添加title属性
            nameContainer.appendChild(nameSpan);
            
            // 检查文件名是否被截断
            setTimeout(() => {
                if (nameSpan.scrollWidth > nameSpan.clientWidth) {
                    nameSpan.classList.add('truncated');
                }
            }, 0);
        }
        
        // 将包含图标和文件名的容器添加到单元格
        nameCell.appendChild(nameContainer);
        row.appendChild(nameCell);
        
        // 大小 - 文件夹显示递归计算的总大小
        const sizeCell = document.createElement('td');
        sizeCell.className = 'col-size';
        
        if (file.is_folder) {
            // 初始显示计算中...
            sizeCell.textContent = '计算中...';
            sizeCell.dataset.folderId = file.id;
            
            // 将需要计算大小的文件夹添加到待处理队列
            FileManager.pendingSizeCalculations.push({
                id: file.id,
                cell: sizeCell
            });
        } else {
            // 使用file_size或size字段
            const fileSize = parseInt(file.file_size || file.size || 0, 10);
            sizeCell.textContent = formatSize(fileSize);
        }
        
        row.appendChild(sizeCell);
        
        // 创建时间
        const dateCell = document.createElement('td');
        dateCell.className = 'col-date';
        dateCell.textContent = moment(file.created_at).format('YYYY-MM-DD HH:mm:ss');
        row.appendChild(dateCell);
        
        // 操作
        const actionsCell = document.createElement('td');
        actionsCell.className = 'col-actions';
        
        // 创建操作按钮容器
        const actionButtons = document.createElement('div');
        actionButtons.className = 'action-buttons';
        
        // 下载按钮
        if (!file.is_folder) {
            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'btn btn-sm btn-outline-primary';
            downloadBtn.innerHTML = '<i class="bi bi-download"></i>';
            downloadBtn.title = '下载';
            downloadBtn.onclick = function() {
                openTelegramFile(file.file_id || file.id);
            };
            actionButtons.appendChild(downloadBtn);
        }
        
        // 移动按钮
        const moveBtn = document.createElement('button');
        moveBtn.className = 'btn btn-sm btn-outline-info';
        moveBtn.innerHTML = '<i class="bi bi-folder-symlink"></i>';
        moveBtn.title = '移动';
        moveBtn.onclick = function() {
            showMoveModal(file.id);
        };
        actionButtons.appendChild(moveBtn);
        
        // 重命名按钮
        const renameBtn = document.createElement('button');
        renameBtn.className = 'btn btn-sm btn-outline-secondary';
        renameBtn.innerHTML = '<i class="bi bi-pencil"></i>';
        renameBtn.title = '重命名';
        renameBtn.onclick = function() {
            showRenameModal(file.id, file.name || file.filename);
        };
        actionButtons.appendChild(renameBtn);
        
        // 删除按钮
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-sm btn-outline-danger';
        deleteBtn.innerHTML = '<i class="bi bi-trash"></i>';
        deleteBtn.title = '删除';
        deleteBtn.onclick = function() {
            deleteFile(file.id, file.is_folder);
        };
        actionButtons.appendChild(deleteBtn);
        
        // 将按钮容器添加到单元格
        actionsCell.appendChild(actionButtons);
        
        row.appendChild(actionsCell);
        fileList.appendChild(row);
    });
    
    // 更新分页
    updatePagination(FileManager.filteredFiles.length);
    
    // 批量处理文件夹大小计算
    processFolderSizeCalculations();
}

// 批量处理文件夹大小计算，避免同时计算过多文件夹导致性能问题
function processFolderSizeCalculations() {
    if (FileManager.pendingSizeCalculations.length === 0) return;
    
    // 取出一批待处理的文件夹
    const batch = FileManager.pendingSizeCalculations.splice(0, FileManager.sizeCalculationBatch);
    
    // 处理这一批文件夹
    batch.forEach(item => {
        calculateFolderSizeLocally(item.id).then(size => {
            // 更新大小显示
            if (item.cell && document.contains(item.cell)) {
                if (size === 0) {
                    item.cell.textContent = '0 B';
                } else {
                    item.cell.textContent = formatSize(size);
                }
            }
        }).catch(error => {
            console.error('计算文件夹大小出错:', error);
            if (item.cell && document.contains(item.cell)) {
                item.cell.textContent = '-';
            }
        });
    });
    
    // 如果还有待处理的文件夹，延迟处理下一批
    if (FileManager.pendingSizeCalculations.length > 0) {
        setTimeout(processFolderSizeCalculations, FileManager.sizeCalculationDelay);
    }
}

// 更新面包屑
function updateBreadcrumb(folderPath) {
    const breadcrumb = document.getElementById('breadcrumb');
    const ol = breadcrumb.querySelector('ol');
    ol.innerHTML = '';
    
    // 确保 folderPath 是数组
    if (!Array.isArray(folderPath)) {
        console.error('folderPath 不是数组:', folderPath);
        folderPath = [];
    }
    
    // 添加根目录
    const rootItem = document.createElement('li');
    rootItem.className = 'breadcrumb-item';
    const rootLink = document.createElement('a');
    rootLink.href = '#';
    rootLink.textContent = '根目录';
    rootLink.dataset.id = 'null';
    rootLink.onclick = function(e) {
        e.preventDefault();
        // 重置当前文件夹ID和路径
        FileManager.currentFolderId = null;
        FileManager.currentPath = '';
        loadFiles();
    };
    rootItem.appendChild(rootLink);
    ol.appendChild(rootItem);
    
    // 添加文件夹路径
        folderPath.forEach((folder, index) => {
            const item = document.createElement('li');
            item.className = 'breadcrumb-item';
        
            if (index === folderPath.length - 1) {
            // 当前文件夹
                item.classList.add('active');
            item.textContent = folder.name;
            } else {
            // 父文件夹
            const link = document.createElement('a');
            link.href = '#';
            link.textContent = folder.name;
            link.dataset.id = folder.id;
            link.onclick = function(e) {
                e.preventDefault();
                loadFiles(folder.id);
            };
            item.appendChild(link);
        }
        
        ol.appendChild(item);
    });
}

// 显示新建文件夹模态框
function showNewFolderModal() {
    try {
        if (!FileManager.modals.newFolderModal) {
            const modalElement = document.getElementById('newFolderModal');
            if (modalElement) {
                FileManager.modals.newFolderModal = new bootstrap.Modal(modalElement);
            } else {
                throw new Error('找不到新建文件夹模态框元素');
            }
        }
        
    // 清空输入框
        const folderNameInput = document.getElementById('folderName');
        if (folderNameInput) {
            folderNameInput.value = '';
        }
        
        // 在模态框显示后聚焦到输入框
        FileManager.modals.newFolderModal._element.addEventListener('shown.bs.modal', () => {
            if (folderNameInput) {
                folderNameInput.focus();
            }
        }, { once: true });
        
    // 显示模态框
    FileManager.modals.newFolderModal.show();
    } catch (error) {
        console.error('显示新建文件夹模态框失败:', error);
        showToast('无法显示新建文件夹窗口: ' + error.message, 'error');
    }
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
                parent_id: FileManager.currentFolderId
            })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            showToast('文件夹创建成功');
            
            // 安全地关闭模态框
            if (FileManager.modals.newFolderModal) {
                FileManager.modals.newFolderModal.hide();
        } else {
                const modalElement = document.getElementById('newFolderModal');
                if (modalElement) {
                    const modal = bootstrap.Modal.getInstance(modalElement);
                    if (modal) {
                        modal.hide();
                    }
                }
            }
            
            // 清空输入框
            document.getElementById('folderName').value = '';
            
            // 重置到第一页并重新加载文件列表
            FileManager.currentPage = 1;
            await loadFiles();
        } else {
            showToast(result.error || '文件夹创建失败', 'error');
        }
    } catch (error) {
        console.error('创建文件夹出错:', error);
        showToast('文件夹创建失败: ' + error.message, 'error');
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
    
    FileManager.modals.moveModal._element.addEventListener('hidden.bs.modal', function () {
        if (triggerButton && typeof triggerButton.focus === 'function') {
            setTimeout(() => triggerButton.focus(), 0);
        }
        // 清理搜索框
        if (searchContainer && searchContainer.parentNode) {
            searchContainer.parentNode.removeChild(searchContainer);
        }
    }, { once: true });
    
    FileManager.modals.moveModal.show();
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
    
    FileManager.modals.batchMoveModal._element.addEventListener('hidden.bs.modal', function () {  // 使用FileManager.modals.batchMoveModal
        if (triggerButton && typeof triggerButton.focus === 'function') {
            setTimeout(() => triggerButton.focus(), 0);
        }
        // 清理搜索框
        if (searchContainer && searchContainer.parentNode) {
            searchContainer.parentNode.removeChild(searchContainer);
        }
    }, { once: true });
    
    FileManager.modals.batchMoveModal.show();  // 使用FileManager.modals.batchMoveModal
}

// 移动文件
async function moveFile() {
    try {
        // 获取目标文件夹ID
        const targetFolderRadio = document.querySelector('input[name="folderSelection"]:checked');
        if (!targetFolderRadio) {
            showToast('请选择目标文件夹', 'error');
            return;
        }
        
        // 保存源文件夹和目标文件夹id
        const sourceParentId = FileManager.movingFileId ? 
            FileManager.allFiles.find(f => f.id === FileManager.movingFileId)?.parent_id : null;
        const targetFolderId = targetFolderRadio.value;
        
        console.log('移动文件/文件夹:', {
            fileId: FileManager.selectedFileId,  // 使用FileManager.selectedFileId
            targetFolderId: targetFolderId
        });
        
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
            FileManager.modals.moveModal.hide();  // 使用FileManager.modals.moveModal
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
    try {
        // 如果已经有待删除的文件，则不再处理
        if (FileManager.pendingDeleteId) {
            console.log('已有待删除的文件，忽略此次请求');
            return;
        }
        
        // 设置待删除的文件ID
    FileManager.pendingDeleteId = id;
    FileManager.pendingDeleteIsFolder = isFolder;
    
    // 设置确认消息
        const confirmMessage = `确定要删除${isFolder ? '文件夹' : '文件'}吗？`;
    document.getElementById('confirmDeleteMessage').textContent = confirmMessage;
    
        // 确保确认删除按钮的事件绑定正确
        const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
        if (confirmDeleteBtn) {
            // 移除之前的事件监听器，防止重复绑定
            const newConfirmDeleteBtn = confirmDeleteBtn.cloneNode(true);
            confirmDeleteBtn.parentNode.replaceChild(newConfirmDeleteBtn, confirmDeleteBtn);
            
            // 确保按钮可以点击
            newConfirmDeleteBtn.disabled = false;
            
            newConfirmDeleteBtn.onclick = async function() {
                try {
                    // 创建进度条容器
                    const progressContainer = document.createElement('div');
                    progressContainer.className = 'progress-container mt-3';
                    progressContainer.innerHTML = `
                        <div class="progress">
                            <div class="progress-bar progress-bar-striped progress-bar-animated" 
                                 role="progressbar" style="width: 0%">0%</div>
                        </div>
                        <div class="text-center mt-2">正在删除...</div>
                    `;
                    
                    // 添加到模态框
                    const modalBody = FileManager.modals.confirmDeleteModal._element.querySelector('.modal-body');
                    modalBody.appendChild(progressContainer);
                    
                    // 禁用确认按钮
                    newConfirmDeleteBtn.disabled = true;
                    
                    // 更新进度条
                    const progressBar = progressContainer.querySelector('.progress-bar');
                    progressBar.style.width = '30%';
                    progressBar.textContent = '30%';
                    
                    // 执行删除
                    await performDelete(id);
                    
                    // 更新进度条
                    progressBar.style.width = '100%';
                    progressBar.textContent = '100%';
                    
                    // 显示成功消息
                showToast('删除成功');
                    
                    // 关闭模态框并刷新文件列表
                    FileManager.modals.confirmDeleteModal.hide();
                loadFiles();
    } catch (error) {
                    console.error('删除失败:', error);
            showToast(`删除失败: ${error.message}`, 'error');
        } finally {
                    // 确保在任何情况下都重置状态
                    FileManager.pendingDeleteId = null;
                    FileManager.pendingDeleteIsFolder = false;
                    // 如果模态框仍然显示，则关闭它
                    if (FileManager.modals.confirmDeleteModal && FileManager.modals.confirmDeleteModal._element.classList.contains('show')) {
                FileManager.modals.confirmDeleteModal.hide();
                    }
                }
            };
            console.log('已重新绑定确认删除按钮点击事件');
        }
        
        // 显示确认对话框
        if (FileManager.modals.confirmDeleteModal) {
            // 确保在显示模态框前清除之前的进度条
            const modalBody = FileManager.modals.confirmDeleteModal._element.querySelector('.modal-body');
            const existingProgressContainer = modalBody.querySelector('.progress-container');
            if (existingProgressContainer) {
                modalBody.removeChild(existingProgressContainer);
            }
            
            FileManager.modals.confirmDeleteModal.show();
        } else {
            console.error('确认删除模态框未初始化');
            showToast('系统错误：确认删除模态框未初始化', 'error');
        FileManager.pendingDeleteId = null;
        FileManager.pendingDeleteIsFolder = false;
        }
    } catch (error) {
        console.error('删除文件时出错:', error);
        showToast(`删除失败: ${error.message}`, 'error');
        FileManager.pendingDeleteId = null;
        FileManager.pendingDeleteIsFolder = false;
    }
}

// 实际执行删除操作
async function performDelete(fileId) {
    try {
        // 保存父文件夹id，用于后续更新缓存
        const fileToDelete = FileManager.allFiles.find(f => f.id === fileId);
        const parentId = fileToDelete ? fileToDelete.parent_id : null;
        
        showToast('正在删除...', 'info');
        
        const response = await fetch(`/api/files/${fileId}`, {
            method: 'DELETE',
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            }
        }).then(res => res.json());
        
        if (response.success) {
            showToast('删除成功', 'success');
            
            // 删除成功后更新父文件夹缓存
            if (parentId) {
                await updateFolderCache(parentId);
            }
            
            // 重新加载文件列表
            await loadFiles();
        } else {
            showToast('删除失败: ' + (response.message || '未知错误'), 'error');
        }
    } catch (error) {
        console.error('删除失败:', error);
        showToast('删除失败: ' + error.message, 'error');
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
    // 如果已经有待删除的文件，则不再处理
    if (FileManager.pendingBatchDeleteFiles) {
        console.log('已有待删除的文件，忽略此次请求');
        return;
    }
    
    const selectedCheckboxes = document.querySelectorAll('#fileList input[type="checkbox"]:checked');
    if (selectedCheckboxes.length === 0) {
        showToast('请先选择要删除的文件', 'warning');
        return;
    }

    // 收集选中的文件ID
    const selectedIds = Array.from(selectedCheckboxes)
        .map(cb => cb.value)
        .filter(id => id); // 过滤掉undefined或null的ID

    if (selectedIds.length === 0) {
        showToast('没有有效的文件ID', 'error');
        return;
    }

    // 设置批量删除的文件ID
    FileManager.pendingBatchDeleteFiles = selectedIds;
    
    // 设置确认消息
    const confirmMessage = `确定要删除选中的 ${selectedIds.length} 个文件吗？`;
    document.getElementById('confirmDeleteMessage').textContent = confirmMessage;
    
    // 确保确认删除按钮的事件绑定正确
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    if (confirmDeleteBtn) {
        // 移除之前的事件监听器，防止重复绑定
        const newConfirmDeleteBtn = confirmDeleteBtn.cloneNode(true);
        confirmDeleteBtn.parentNode.replaceChild(newConfirmDeleteBtn, confirmDeleteBtn);
        
        // 确保按钮可以点击
        newConfirmDeleteBtn.disabled = false;
        
        newConfirmDeleteBtn.onclick = async function() {
            try {
                // 创建进度条容器
                const progressContainer = document.createElement('div');
                progressContainer.className = 'progress-container mt-3';
                progressContainer.innerHTML = `
                    <div class="progress">
                        <div class="progress-bar progress-bar-striped progress-bar-animated" 
                             role="progressbar" style="width: 0%">0%</div>
                    </div>
                    <div class="text-center mt-2">正在删除文件...</div>
                `;
                
                // 添加到模态框
                const modalBody = FileManager.modals.confirmDeleteModal._element.querySelector('.modal-body');
                modalBody.appendChild(progressContainer);
                
                // 禁用确认按钮
                newConfirmDeleteBtn.disabled = true;
                
                // 使用 Promise.all 并行处理删除请求
                const totalFiles = selectedIds.length;
                let successCount = 0;
                let failedCount = 0;
                
                // 创建所有删除请求
                const deletePromises = selectedIds.map(async (fileId, index) => {
                    try {
                        await performDelete(fileId);
                        successCount++;
                    } catch (error) {
                        failedCount++;
                        console.error(`删除文件 ${fileId} 失败:`, error);
                    }
                    
                    // 更新进度
                    const progress = Math.round(((index + 1) / totalFiles) * 100);
                    const progressBar = progressContainer.querySelector('.progress-bar');
                    progressBar.style.width = `${progress}%`;
                    progressBar.textContent = `${progress}%`;
                });
                
                // 等待所有删除操作完成
                await Promise.all(deletePromises);
                
                // 显示结果
                if (successCount === totalFiles) {
                    showToast('批量删除成功');
                } else if (successCount > 0) {
                    showToast(`部分文件删除成功 (${successCount}/${totalFiles})`, 'warning');
                } else {
                    showToast('所有文件删除失败', 'error');
                }
                
                // 关闭模态框并刷新文件列表
                FileManager.modals.confirmDeleteModal.hide();
                loadFiles();
            } catch (error) {
                console.error('批量删除失败:', error);
                showToast(`批量删除失败: ${error.message}`, 'error');
            } finally {
                // 确保在任何情况下都重置状态
                FileManager.pendingBatchDeleteFiles = null;
                // 如果模态框仍然显示，则关闭它
                if (FileManager.modals.confirmDeleteModal && FileManager.modals.confirmDeleteModal._element.classList.contains('show')) {
                    FileManager.modals.confirmDeleteModal.hide();
                }
            }
        };
        console.log('已重新绑定确认删除按钮点击事件');
    }
    
    // 显示确认对话框
    if (FileManager.modals.confirmDeleteModal) {
        // 确保在显示模态框前清除之前的进度条
        const modalBody = FileManager.modals.confirmDeleteModal._element.querySelector('.modal-body');
        const existingProgressContainer = modalBody.querySelector('.progress-container');
        if (existingProgressContainer) {
            modalBody.removeChild(existingProgressContainer);
        }
        
    FileManager.modals.confirmDeleteModal.show();
    } else {
        console.error('确认删除模态框未初始化');
        showToast('系统错误：确认删除模态框未初始化', 'error');
        FileManager.pendingBatchDeleteFiles = null;
    }
}

// 批量移动文件
async function batchMoveFiles() {
    try {
        // ... existing code ...
        
        // 保存源文件夹ID集合
        const sourceParentIds = new Set();
        selectedFiles.forEach(fileId => {
            const file = FileManager.allFiles.find(f => f.id === fileId);
            if (file && file.parent_id) {
                sourceParentIds.add(file.parent_id);
            }
        });
        
        // ... existing batch move logic ...
        
        if (response.success) {
            // 更新所有源文件夹和目标文件夹的缓存
            for (const parentId of sourceParentIds) {
                await updateFolderCache(parentId);
            }
            if (targetFolderId) {
                await updateFolderCache(targetFolderId);
            }
            
            // ... existing code ...
        } else {
            // ... existing code ...
        }
    } catch (error) {
        // ... existing code ...
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
        
        // 更新 FileManager.allFiles
        FileManager.allFiles = files.map(file => ({
            id: file.id,
            filename: file.filename || file.name || '未命名',
            file_id: file.file_id,
            message_id: file.message_id,
            parent_id: file.parent_id,
            is_folder: file.is_folder || false,
            size: file.file_size || 0,
            mime_type: file.mime_type,
            created_at: file.created_at
        }));
        
        // 更新 FileManager.filteredFiles
        FileManager.filteredFiles = FileManager.allFiles.filter(file => 
            file.filename.toLowerCase().includes(searchTerm)
        );
        
        // 渲染文件列表
        renderFileList();
        
        // 更新文件统计信息
        updateFileStats();
        
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
    FileManager.modals.renameModal._element.addEventListener('shown.bs.modal', () => {
        nameInput.focus();
        nameInput.select();
    }, { once: true });
    
    FileManager.modals.renameModal.show();
}

// 执行重命名
async function renameItem() {
    const newName = document.getElementById('newName').value.trim();
    if (!newName) {
        showToast('请输入新名称', 'error');
        return;
    }
    
    try {
        const response = await fetch(`/api/files/${FileManager.selectedItemId}/rename`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newName })
        });
        
        if (response.ok) {
            showToast('重命名成功');
            FileManager.modals.renameModal.hide();
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
        console.log('开始打开文件，参数:', {
            fileId: fileId,
            type: typeof fileId,
            allFilesCount: FileManager.allFiles?.length || 0
        });
        
        // 确保FileManager.allFiles存在
        if (!FileManager.allFiles || !Array.isArray(FileManager.allFiles)) {
            throw new Error('文件列表未初始化');
        }
        
        // 获取文件信息 - 首先尝试通过id查找
        let file = FileManager.allFiles.find(f => String(f.id) === String(fileId));
        
        // 如果通过id没找到，尝试通过file_id查找
        if (!file && fileId.includes(':')) {
            file = FileManager.allFiles.find(f => f.file_id === fileId);
        }
        
        console.log('找到的文件信息:', file);
        
        if (!file) {
            throw new Error('文件不存在');
        }
        
        // 获取消息ID，优先使用message_id
        const messageId = file.message_id || 
                         (file.file_id && file.file_id.includes(':') ? 
                          file.file_id.split(':')[1] : null);
                          
        console.log('提取的消息ID:', messageId);
        
        if (!messageId) {
            throw new Error('无法获取消息ID');
        }
        
        // 尝试构建电报链接
        const chatId = file.file_id && file.file_id.includes(':') ? 
                      file.file_id.split(':')[0] : null;
                      
        console.log('提取的聊天ID:', chatId);
        
        if (chatId) {
            // 构建Telegram链接
            const url = `https://t.me/c/${chatId.replace('-100', '')}/${messageId}`;
            console.log('生成的Telegram链接:', url);
            window.open(url, '_blank');
        } else {
            // 回退到直接下载
            const encodedFileName = encodeURIComponent(file.filename || file.name || '未命名文件');
            const downloadUrl = `/proxy/${fileId}?original_name=${encodedFileName}`;
            console.log('生成的下载链接:', downloadUrl);
            window.open(downloadUrl, '_blank');
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
        console.log('开始页面初始化...');
        
        // 初始化 FileManager 对象
        window.FileManager = {
            currentFolderId: null,
            currentPage: 1,
            pageSize: parseInt(localStorage.getItem('pageSize')) || 20,
            allFiles: [],
            filteredFiles: [],
            folderSizeCache: {},
            sortField: 'name',
            sortOrder: 'asc',
            selectedFiles: new Set()
        };
        
        // 初始化模态框
        const modalIds = {
            newFolderModal: 'newFolderModal',
            moveModal: 'moveModal',
            batchMoveModal: 'batchMoveModal',
            confirmDeleteModal: 'confirmDeleteModal',
            changePasswordModal: 'changePasswordModal',
            renameModal: 'renameModal',
            previewModal: 'previewModal'
        };
        
        // 初始化每个模态框并保存到FileManager中
        Object.entries(modalIds).forEach(([key, modalId]) => {
            const modalElement = document.getElementById(modalId);
            if (modalElement) {
                FileManager[key] = new bootstrap.Modal(modalElement);
                console.log(`已初始化模态框: ${modalId}`);
            } else {
                console.error(`找不到模态框元素: ${modalId}`);
            }
        });
        
        // 设置页面大小选择器的值
    const pageSizeSelect = document.getElementById('pageSize');
    if (pageSizeSelect) {
            pageSizeSelect.value = FileManager.pageSize;
            pageSizeSelect.addEventListener('change', function() {
                FileManager.pageSize = parseInt(this.value);
                localStorage.setItem('pageSize', this.value);
                renderFileList();
            });
        }
        
        // 绑定分页事件
        const prevPage = document.getElementById('prevPage');
        const nextPage = document.getElementById('nextPage');
        
        if (prevPage) {
            prevPage.addEventListener('click', function(e) {
                e.preventDefault();
                if (FileManager.currentPage > 1) {
                    FileManager.currentPage--;
                    renderFileList();
                }
            });
        }
        
        if (nextPage) {
            nextPage.addEventListener('click', function(e) {
                e.preventDefault();
                if (FileManager.currentPage < FileManager.totalPages) {
                    FileManager.currentPage++;
                    renderFileList();
                }
            });
        }
        
        // 在主页时加载文件列表
        if (window.location.pathname.includes('index.html') || window.location.pathname === '/' || window.location.pathname === '') {
            console.log('加载文件列表...');
            
            // 显示主内容区域
            const mainContent = document.getElementById('main-content');
            if (mainContent) {
                mainContent.style.display = 'block';
                console.log('主内容区域已显示');
            } else {
                console.error('找不到主内容区域元素');
            }
            
            // 加载文件列表
            await loadFiles();
            
            // 初始化排序图标
            updateSortIcon();
            
            console.log('页面初始化完成');
        }
    } catch (error) {
    console.error('页面初始化错误:', error);
        showToast(`页面初始化失败: ${error.message}`, 'error');
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
    try {
        console.log('更新文件夹大小缓存:', folderId);
        if (!folderId) return;
        
        // 清除当前文件夹的缓存
        delete FileManager.folderSizeCache[folderId];
        
        // 清除所有父文件夹的缓存
        let currentId = folderId;
        const processed = new Set(); // 防止循环引用
        
        while (currentId && !processed.has(currentId)) {
            processed.add(currentId);
            const parent = FileManager.allFiles.find(f => f.id === currentId);
            if (!parent || !parent.parent_id) break;
            
            currentId = parent.parent_id;
            delete FileManager.folderSizeCache[currentId];
        }
        
        // 重新计算当前文件夹大小
        await calculateFolderSize(folderId);
        
        // 如果当前正在按大小排序，需要重新排序和渲染列表
        if (FileManager.sortField === 'size' && FileManager.filteredFiles) {
            FileManager.filteredFiles = sortFiles(FileManager.filteredFiles, FileManager.sortField, FileManager.sortOrder);
            renderFileList();
        }
        
        // 更新文件统计信息
        updateFileStats();
        
        console.log('文件夹缓存更新完成:', folderId);
    } catch (error) {
        console.error('更新文件夹缓存失败:', error);
    }
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

// 更新文件统计信息
function updateFileStats() {
    try {
        console.log('开始更新文件统计信息');
        
        const stats = {
            totalFiles: 0,
            totalFolders: 0,
            totalSize: 0
        };

        if (!FileManager.filteredFiles) {
            console.warn('FileManager.filteredFiles未定义');
            return;
        }

        console.log('当前过滤后的文件列表:', FileManager.filteredFiles);

        FileManager.filteredFiles.forEach(file => {
            if (file.is_folder) {
                stats.totalFolders++;
                const folderSize = FileManager.folderSizeCache[file.id] || 0;
                stats.totalSize += folderSize;
            } else {
                stats.totalFiles++;
                stats.totalSize += file.size || 0;
            }
        });

        console.log('统计结果:', stats);

        const statsElement = document.getElementById('fileStats');
        if (!statsElement) {
            console.error('找不到文件统计信息元素');
            return;
        }

        statsElement.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <span><i class="bi bi-folder me-1"></i>${stats.totalFolders} 个文件夹</span>
                <span><i class="bi bi-file-earmark me-1"></i>${stats.totalFiles} 个文件</span>
                <span><i class="bi bi-hdd me-1"></i>总大小: ${formatSize(stats.totalSize)}</span>
            </div>
        `;
        
        console.log('文件统计信息更新完成');
    } catch (error) {
        console.error('更新文件统计信息时出错:', error);
        const statsElement = document.getElementById('fileStats');
        if (statsElement) {
            statsElement.innerHTML = `
                <div class="text-danger">
                    <i class="bi bi-exclamation-triangle me-1"></i>
                    统计信息更新失败
                </div>
            `;
        }
    }
}

// 文件操作后更新相关文件夹缓存
async function updateFolderCache(folderId) {
    if (!folderId) return;
    
    try {
        console.log('开始更新文件夹缓存:', folderId);
        
        // 清除当前文件夹的缓存
        delete FileManager.folderSizeCache[folderId];
        
        // 清除所有父文件夹的缓存
        let currentId = folderId;
        const processed = new Set(); // 防止循环引用
        
        while (currentId && !processed.has(currentId)) {
            processed.add(currentId);
            const parent = FileManager.allFiles.find(f => f.id === currentId);
            if (!parent || !parent.parent_id) break;
            
            currentId = parent.parent_id;
            delete FileManager.folderSizeCache[currentId];
        }
        
        // 重新计算当前文件夹大小
        await calculateFolderSizeLocally(folderId);
        
        // 如果当前正在按大小排序，需要重新渲染列表
        if (FileManager.sortField === 'size') {
            renderFileList();
        }
        
        console.log('文件夹缓存更新完成:', folderId);
    } catch (error) {
        console.error('更新文件夹缓存失败:', error);
    }
}

// 修改上传成功后的处理逻辑
async function uploadSuccess(file) {
    // ... existing code ...
    
    // 更新父文件夹的大小缓存
    if (file.parent_id) {
        await updateFolderCache(file.parent_id);
    }
}

// 修改deleteFile函数
async function deleteFile(id, isFolder) {
    // ... existing code ...
    
    // 保存父文件夹id，用于后续更新缓存
    const fileToDelete = FileManager.allFiles.find(f => f.id === id);
    const parentId = fileToDelete ? fileToDelete.parent_id : null;
    
    // ... existing delete logic ...
    
    // 删除成功后更新父文件夹缓存
    if (parentId) {
        await updateFolderCache(parentId);
    }
}

// 修改moveFile函数
async function moveFile() {
    // ... existing code ...
    
    // 保存源文件夹和目标文件夹id
    const sourceParentId = FileManager.movingFileId ? 
        FileManager.allFiles.find(f => f.id === FileManager.movingFileId)?.parent_id : null;
    
    // ... existing move logic ...
    
    // 更新源文件夹和目标文件夹的缓存
    if (sourceParentId) {
        await updateFolderCache(sourceParentId);
    }
    if (targetFolderId && targetFolderId !== sourceParentId) {
        await updateFolderCache(targetFolderId);
    }
}

// 删除选定的文件
function deleteSelectedFiles() {
    const selectedFileIds = Array.from(document.querySelectorAll('.file-checkbox:checked')).map(cb => cb.value);
    if (selectedFileIds.length === 0) {
        showToast('请选择要删除的文件', 'warning');
        return;
    }

    // 获取所有选定文件的父文件夹ID，用于后续更新缓存
    const parentFolderIds = new Set();
    selectedFileIds.forEach(id => {
        const file = FileManager.allFiles.find(f => f.id.toString() === id.toString());
        if (file && file.parent_id) {
            parentFolderIds.add(file.parent_id);
        }
    });

    fetch('/api/delete', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids: selectedFileIds })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // 更新所有相关文件夹的缓存
            const updatePromises = Array.from(parentFolderIds).map(folderId => updateFolderSizeCache(folderId));
            
            Promise.all(updatePromises).then(() => {
                loadCurrentFolder();
                showToast('删除成功');
            });
        } else {
            showToast('删除失败: ' + data.message, 'error');
        }
    })
    .catch(error => {
        console.error('删除文件出错:', error);
        showToast('删除文件失败，请重试', 'error');
    });
}

// 移动文件
function moveFiles() {
    const targetFolderId = document.querySelector('input[name="target_folder"]:checked')?.value;
    
    if (!targetFolderId) {
        showToast('请选择目标文件夹', 'error');
        return;
    }
    
    if (!FileManager.clipboard || !FileManager.clipboard.files || FileManager.clipboard.files.length === 0) {
        showToast('没有选择要移动的文件', 'error');
        return;
    }
    
    // 获取源文件夹ID集合，用于后续更新缓存
    const sourceParentIds = new Set();
    FileManager.clipboard.files.forEach(file => {
        if (file.parent_id) {
            sourceParentIds.add(file.parent_id);
        }
    });

    fetch('/api/move', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            ids: FileManager.clipboard.files.map(f => f.id),
            destination: targetFolderId === 'null' ? null : targetFolderId
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // 更新所有相关文件夹的缓存
            const foldersToUpdate = new Set([...sourceParentIds]);
            if (targetFolderId !== 'null') {
                foldersToUpdate.add(targetFolderId);
            }
            
            const updatePromises = Array.from(foldersToUpdate).map(folderId => 
                updateFolderSizeCache(folderId)
            );
            
            Promise.all(updatePromises).then(() => {
                FileManager.clipboard = { action: null, files: [] };
                loadCurrentFolder();
                showToast('移动成功');
            });
        } else {
            showToast('移动失败: ' + data.message, 'error');
        }
    })
    .catch(error => {
        console.error('移动文件出错:', error);
        showToast('移动文件失败，请重试', 'error');
    });
}
