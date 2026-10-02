const API_BASE = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
    ? (window.location.port === '5000' ? '/api' : 'http://localhost:5000/api')
    : '/api';

let authToken = localStorage.getItem('abu_rabie_admin_token') || null;

function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = type;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 3500);
}

// Auth Header Helper
function getHeaders() {
    return {
'Content-Type': 'application/json',
'Authorization': `Bearer ${authToken}`
    };
}

// Check Login State
function checkAuth() {
    if (!authToken) {
document.getElementById('login-screen').style.display = 'flex';
    } else {
document.getElementById('login-screen').style.display = 'none';
loadDashboardStats();
    }
}

// Login Handler
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    try {
const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
});
const data = await res.json();
if (data.success) {
    authToken = data.data.token;
    localStorage.setItem('abu_rabie_admin_token', authToken);
    document.getElementById('login-screen').style.display = 'none';
    showToast('تم تسجيل الدخول بنجاح');
    loadDashboardStats();
} else {
    showToast(data.message || 'بيانات الدخول غير صحيحة', 'error');
}
    } catch (err) {
showToast('تعذر الاتصال بالخادم. تأكد من تشغيل السيرفر', 'error');
    }
});

// Logout Handler
document.getElementById('btn-logout').addEventListener('click', () => {
    localStorage.removeItem('abu_rabie_admin_token');
    authToken = null;
    document.getElementById('login-screen').style.display = 'flex';
});

// Tabs Navigation
const navItems = document.querySelectorAll('.nav-item');
const tabContents = document.querySelectorAll('.tab-content');
const pageTitle = document.getElementById('current-tab-title');

navItems.forEach(item => {
    item.addEventListener('click', (e) => {
e.preventDefault();
navItems.forEach(i => i.classList.remove('active'));
item.classList.add('active');

const tab = item.dataset.tab;
tabContents.forEach(c => c.style.display = 'none');
document.getElementById(`tab-${tab}`).style.display = 'block';
pageTitle.textContent = item.textContent.trim();

if (tab === 'dashboard') loadDashboardStats();
if (tab === 'products') loadProducts();
if (tab === 'orders') loadOrders();
if (tab === 'contacts') loadContacts();
    });
});

// Load Dashboard
async function loadDashboardStats() {
    try {
const res = await fetch(`${API_BASE}/stats/dashboard`, { headers: getHeaders() });
const json = await res.json();
if (json.success) {
    const data = json.data;
    document.getElementById('stat-products').textContent = data.products.total;
    document.getElementById('stat-orders').textContent = data.orders.total;
    document.getElementById('stat-revenue').textContent = (data.orders.revenue || 0).toLocaleString();
    document.getElementById('stat-messages').textContent = data.contacts.unread;

    // Render recent orders
    const tbody = document.getElementById('dashboard-recent-orders');
    if (!data.recentOrders || data.recentOrders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">لا توجد طلبات حديثة</td></tr>';
    } else {
        tbody.innerHTML = data.recentOrders.map(o => `
            <tr>
                <td><strong>${o.orderNumber}</strong></td>
                <td>${o.customerName}</td>
                <td>${o.customerPhone}</td>
                <td><strong style="color: var(--primary);">${o.totalAmount} ج.م</strong></td>
                <td><span class="badge ${o.status === 'مكتمل' ? 'badge-success' : o.status === 'ملغي' ? 'badge-danger' : 'badge-warning'}">${o.status}</span></td>
                <td>${new Date(o.createdAt).toLocaleDateString('ar-EG')}</td>
            </tr>
        `).join('');
    }
}
    } catch (err) {
console.error(err);
    }
}

// Admin tables are paginated and filtered through the API. Loading
// `?limit=100` once meant only the first 100 of the imported products could
// ever be found or edited from the dashboard.
const ADMIN_PAGE_SIZE = 25;

const tableState = {
    products: { page: 1, totalPages: 1, search: '' },
    orders: { page: 1, totalPages: 1, search: '' },
};

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[c]));
}

function renderPagination(kind, currentPage, totalPages) {
    const container = document.getElementById(`${kind}-pagination`);
    if (!container) return;

    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    const buttons = [];
    const push = (p, label, disabled, active) => {
        buttons.push(
            `<button class="page-btn${active ? ' active' : ''}" data-page="${p}"${
                disabled ? ' disabled' : ''
            }>${label}</button>`
        );
    };

    push(currentPage - 1, '<i class="fa-solid fa-chevron-right"></i>', currentPage === 1, false);

    for (let i = 1; i <= totalPages; i += 1) {
        if (i === 1 || i === totalPages || Math.abs(i - currentPage) <= 2) {
            push(i, i, false, i === currentPage);
        }
    }

    push(
        currentPage + 1,
        '<i class="fa-solid fa-chevron-left"></i>',
        currentPage === totalPages,
        false
    );

    container.innerHTML = buttons.join('');

    container.querySelectorAll('.page-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const next = Number(btn.dataset.page);
            if (!next || next < 1 || next > totalPages || next === currentPage) return;
            tableState[kind].page = next;
            if (kind === 'products') loadProducts();
            else loadOrders();
        });
    });
}

function renderTableInfo(kind, total, currentPage, totalPages, perPage) {
    const el = document.getElementById(`${kind}-info`);
    if (!el) return;

    if (total === 0) {
        el.textContent = '';
        return;
    }

    const from = (currentPage - 1) * perPage + 1;
    const to = Math.min(currentPage * perPage, total);
    el.textContent = `عرض ${from} - ${to} من ${total} (صفحة ${currentPage} من ${totalPages})`;
}

function debounce(fn, wait) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
}

// Load Products
async function loadProducts() {
    const tbody = document.getElementById('products-table-body');
    const s = tableState.products;

    const params = new URLSearchParams({
        page: String(s.page),
        limit: String(ADMIN_PAGE_SIZE),
    });
    if (s.search) params.set('search', s.search);

    try {
        const res = await fetch(`${API_BASE}/products?${params.toString()}`, { headers: getHeaders() });
        const json = await res.json();

        // Deleting the last row on a page can leave the page number past the
        // end, which would otherwise show a misleading "no matches" state.
        if (json.success && json.data.length === 0 && json.totalPages > 0 && s.page > json.totalPages) {
            s.page = json.totalPages;
            return loadProducts();
        }

        if (json.success && json.data.length > 0) {
            s.page = json.currentPage || s.page;
            s.totalPages = json.totalPages || 1;

            tbody.innerHTML = json.data.map(p => `
        <tr>
            <td>
                <img src="${escapeHtml(p.image) || '../assets/logo.jpg'}" class="product-thumb" alt="${escapeHtml(p.name)}" onerror="this.src='../assets/logo.jpg'">
            </td>
            <td><strong>${escapeHtml(p.name)}</strong></td>
            <td>${escapeHtml(p.sku) || '-'}</td>
            <td>${escapeHtml(p.brand) || 'عام'}</td>
            <td>${p.price} ج.م</td>
            <td>${p.salePrice ? `<strong style="color: var(--primary);">${p.salePrice} ج.م</strong>` : '-'}</td>
            <td>
                <span class="badge ${p.inStock ? 'badge-success' : 'badge-danger'}">
                    ${p.inStock ? 'متوفر' : 'غير متوفر'}
                </span>
            </td>
            <td>
                <div class="actions-cell">
                    <button class="btn-icon" onclick="editProduct('${p._id}')" title="تعديل"><i class="fa-solid fa-pen-to-square"></i></button>
                    <button class="btn-icon delete" onclick="deleteProduct('${p._id}')" title="حذف"><i class="fa-solid fa-trash"></i></button>
                </div>
            </td>
        </tr>
    `).join('');

            renderPagination('products', s.page, s.totalPages);
            renderTableInfo('products', json.total || 0, s.page, s.totalPages, ADMIN_PAGE_SIZE);
        } else {
            s.totalPages = 1;
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center;">لا توجد منتجات مطابقة.</td></tr>';
            renderPagination('products', 1, 1);
            renderTableInfo('products', 0, 1, 1, ADMIN_PAGE_SIZE);
        }
    } catch (err) {
        console.error(err);
        showToast('خطأ أثناء تحميل المنتجات', 'error');
    }
}

// Product Modal Handlers
const modal = document.getElementById('product-modal');
document.getElementById('btn-add-product').addEventListener('click', () => {
    document.getElementById('product-form').reset();
    document.getElementById('prod-id').value = '';
    document.getElementById('modal-product-title').textContent = 'إضافة منتج جديد';
    modal.classList.add('active');
});
document.getElementById('btn-close-modal').addEventListener('click', () => {
    modal.classList.remove('active');
});

// Edit Product
window.editProduct = async function(id) {
    try {
const res = await fetch(`${API_BASE}/products/${id}`);
const json = await res.json();
if (json.success) {
    const p = json.data;
    document.getElementById('prod-id').value = p._id;
    document.getElementById('prod-name').value = p.name;
    document.getElementById('prod-sku').value = p.sku || '';
    document.getElementById('prod-brand').value = p.brand || '';
    document.getElementById('prod-price').value = p.price;
    document.getElementById('prod-sale-price').value = p.salePrice || '';
    document.getElementById('prod-category').value = p.categoryName || '';
    document.getElementById('prod-image').value = p.image || '';
    document.getElementById('prod-desc').value = p.description || '';
    document.getElementById('prod-stock').value = p.inStock ? 'true' : 'false';
    document.getElementById('prod-featured').value = p.isFeatured ? 'true' : 'false';

    document.getElementById('modal-product-title').textContent = 'تعديل بيانات المنتج';
    modal.classList.add('active');
}
    } catch (err) {
showToast('تعذر جلب تفاصيل المنتج', 'error');
    }
};

// Save Product (Create or Update)
document.getElementById('product-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('prod-id').value;

    let imageUrl = document.getElementById('prod-image').value;
    const fileInput = document.getElementById('prod-file');

    // Handle image file upload first if selected
    if (fileInput.files.length > 0) {
const formData = new FormData();
formData.append('image', fileInput.files[0]);
try {
    const uploadRes = await fetch(`${API_BASE}/upload/image`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` },
        body: formData
    });
    const uploadData = await uploadRes.json();
    if (uploadData.success) {
        imageUrl = uploadData.data.url;
    }
} catch (err) {
    console.error('Upload failed, continuing with direct url');
}
    }

    const payload = {
name: document.getElementById('prod-name').value,
sku: document.getElementById('prod-sku').value,
brand: document.getElementById('prod-brand').value,
price: Number(document.getElementById('prod-price').value),
salePrice: document.getElementById('prod-sale-price').value ? Number(document.getElementById('prod-sale-price').value) : null,
categoryName: document.getElementById('prod-category').value,
image: imageUrl,
description: document.getElementById('prod-desc').value,
inStock: document.getElementById('prod-stock').value === 'true',
isFeatured: document.getElementById('prod-featured').value === 'true'
    };

    try {
const url = id ? `${API_BASE}/products/${id}` : `${API_BASE}/products`;
const method = id ? 'PUT' : 'POST';

const res = await fetch(url, {
    method,
    headers: getHeaders(),
    body: JSON.stringify(payload)
});
const json = await res.json();
if (json.success) {
    showToast(id ? 'تم تعديل المنتج بنجاح' : 'تم إضافة المنتج بنجاح');
    modal.classList.remove('active');
    loadProducts();
} else {
    showToast(json.message || 'حدث خطأ أثناء الحفظ', 'error');
}
    } catch (err) {
showToast('تعذر حفظ المنتج', 'error');
    }
});

// Delete Product
window.deleteProduct = async function(id) {
    if (!confirm('هل أنت متأكد من رغبتك في حذف هذا المنتج؟')) return;
    try {
const res = await fetch(`${API_BASE}/products/${id}`, {
    method: 'DELETE',
    headers: getHeaders()
});
const json = await res.json();
if (json.success) {
    showToast('تم حذف المنتج بنجاح');
    loadProducts();
} else {
    showToast(json.message || 'فشل حذف المنتج', 'error');
}
    } catch (err) {
showToast('تعذر حذف المنتج', 'error');
    }
};

// Load Orders
async function loadOrders() {
    const tbody = document.getElementById('orders-table-body');
    const s = tableState.orders;

    const params = new URLSearchParams({
        page: String(s.page),
        limit: String(ADMIN_PAGE_SIZE),
    });
    if (s.search) params.set('search', s.search);

    try {
        const res = await fetch(`${API_BASE}/orders?${params.toString()}`, { headers: getHeaders() });
        const json = await res.json();

        if (json.success && json.data.length === 0 && json.totalPages > 0 && s.page > json.totalPages) {
            s.page = json.totalPages;
            return loadOrders();
        }

        if (json.success && json.data.length > 0) {
            s.page = json.currentPage || s.page;
            s.totalPages = json.totalPages || 1;

            tbody.innerHTML = json.data.map(o => `
        <tr>
            <td><strong>${escapeHtml(o.orderNumber)}</strong></td>
            <td>${escapeHtml(o.customerName)}</td>
            <td><a href="tel:${escapeHtml(o.customerPhone)}" style="color: var(--info);">${escapeHtml(o.customerPhone)}</a></td>
            <td>${escapeHtml(o.customerAddress)}</td>
            <td>${o.items ? o.items.map(i => `${escapeHtml(i.name)} (×${i.quantity})`).join('<br>') : '-'}</td>
            <td><strong style="color: var(--primary);">${o.totalAmount} ج.م</strong></td>
            <td>
                <select onchange="updateOrderStatus('${o._id}', this.value)" class="form-control" style="padding: 4px 8px; font-size: 0.85rem;">
                    <option value="جديد" ${o.status === 'جديد' ? 'selected' : ''}>جديد</option>
                    <option value="قيد التنفيذ" ${o.status === 'قيد التنفيذ' ? 'selected' : ''}>قيد التنفيذ</option>
                    <option value="تم الشحن" ${o.status === 'تم الشحن' ? 'selected' : ''}>تم الشحن</option>
                    <option value="مكتمل" ${o.status === 'مكتمل' ? 'selected' : ''}>مكتمل</option>
                    <option value="ملغي" ${o.status === 'ملغي' ? 'selected' : ''}>ملغي</option>
                </select>
            </td>
            <td>
                <a href="https://wa.me/20${escapeHtml(String(o.customerPhone).replace(/^0/, ''))}" target="_blank" rel="noopener" class="btn-icon" style="color: #25D366; text-decoration: none;" title="محادثة واتساب">
                    <i class="fa-brands fa-whatsapp"></i>
                </a>
            </td>
        </tr>
    `).join('');

            renderPagination('orders', s.page, s.totalPages);
            renderTableInfo('orders', json.total || 0, s.page, s.totalPages, ADMIN_PAGE_SIZE);
        } else {
            s.totalPages = 1;
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center;">لا توجد طلبات مطابقة.</td></tr>';
            renderPagination('orders', 1, 1);
            renderTableInfo('orders', 0, 1, 1, ADMIN_PAGE_SIZE);
        }
    } catch (err) {
        console.error(err);
        showToast('خطأ أثناء تحميل الطلبات', 'error');
    }
}

window.updateOrderStatus = async function(id, status) {
    try {
const res = await fetch(`${API_BASE}/orders/${id}/status`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify({ status })
});
const json = await res.json();
if (json.success) {
    showToast(`تم تغيير حالة الطلب إلى "${status}"`);
}
    } catch (err) {
showToast('فشل تحديث الحالة', 'error');
    }
};

// Load Contacts
async function loadContacts() {
    try {
const res = await fetch(`${API_BASE}/contacts`, { headers: getHeaders() });
const json = await res.json();
const tbody = document.getElementById('contacts-table-body');
if (json.success && json.data.length > 0) {
    tbody.innerHTML = json.data.map(c => `
        <tr>
            <td><strong>${c.name}</strong></td>
            <td><a href="tel:${c.phone}" style="color: var(--info);">${c.phone}</a></td>
            <td style="max-width: 300px;">${c.message}</td>
            <td>${new Date(c.createdAt).toLocaleDateString('ar-EG')}</td>
            <td>
                <span class="badge ${c.isRead ? 'badge-success' : 'badge-warning'}">
                    ${c.isRead ? 'تمت القراءة' : 'رسالة جديدة'}
                </span>
            </td>
            <td>
                <div class="actions-cell">
                    ${!c.isRead ? `<button class="btn-icon" onclick="markContactRead('${c._id}')" title="تحديد كمقروء"><i class="fa-solid fa-check"></i></button>` : ''}
                    <a href="https://wa.me/20${c.phone.replace(/^0/, '')}" target="_blank" class="btn-icon" style="color: #25D366; text-decoration: none;" title="مراسلة"><i class="fa-brands fa-whatsapp"></i></a>
                </div>
            </td>
        </tr>
    `).join('');
} else {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">لا توجد رسائل واردة حالياً.</td></tr>';
}
    } catch (err) {
showToast('خطأ أثناء تحميل الرسائل', 'error');
    }
}

window.markContactRead = async function(id) {
    try {
await fetch(`${API_BASE}/contacts/${id}/read`, {
    method: 'PUT',
    headers: getHeaders()
});
loadContacts();
    } catch (err) {
console.error(err);
    }
};

// Check authentication on load
checkAuth();

// Table search boxes
document.getElementById('admin-product-search')?.addEventListener(
    'input',
    debounce((e) => {
        tableState.products.search = e.target.value.trim();
        tableState.products.page = 1;
        loadProducts();
    }, 350)
);

document.getElementById('admin-order-search')?.addEventListener(
    'input',
    debounce((e) => {
        tableState.orders.search = e.target.value.trim();
        tableState.orders.page = 1;
        loadOrders();
    }, 350)
);
