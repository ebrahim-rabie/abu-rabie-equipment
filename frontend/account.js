/**
 * Customer account page.
 *
 * The token is kept in localStorage so the page can reload without a re-login.
 * Everything here is a thin client over /api/customers: the server owns
 * validation, pricing and persistence.
 */
const API_URL =
    window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
        ? (window.location.port === '5000' ? '/api' : 'http://localhost:5000/api')
        : '/api';

const TOKEN_KEY = 'abu_rabie_token';

let token = localStorage.getItem(TOKEN_KEY) || null;
let user = null;
let editingAddressId = null;

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------

const api = async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(`${API_URL}${path}`, {
        method,
        headers: {
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const text = await res.text();
    let json = null;
    try {
        json = JSON.parse(text);
    } catch {
        json = null;
    }

    // An expired token should drop the session rather than leave a dashboard
    // that silently fails every request.
    if (res.status === 401 && path !== '/customers/auth/login') {
        signOut(true);
        throw new Error(json?.message || 'انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى');
    }

    if (!res.ok || (json && json.success === false)) {
        throw new Error(json?.message || 'حدث خطأ غير متوقع');
    }

    return json;
};

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

const setToken = (value) => {
    token = value;
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
};

const signOut = (silent = false) => {
    setToken(null);
    user = null;
    showAuthView();
    if (!silent) toast('تم تسجيل الخروج بنجاح');
};

/**
 * Folds the guest cart kept in localStorage into the account cart, then clears
 * it so the two never drift apart.
 */
const mergeGuestCart = async () => {
    let guestCart = [];
    try {
        guestCart = JSON.parse(localStorage.getItem('abu_rabie_cart') || '[]');
    } catch {
        guestCart = [];
    }

    if (!Array.isArray(guestCart) || guestCart.length === 0) return;

    try {
        const res = await api('/customers/cart/merge', {
            method: 'POST',
            body: { items: guestCart.map((i) => ({ id: i.id, quantity: i.quantity })) },
        });
        localStorage.removeItem('abu_rabie_cart');
        window.dispatchEvent(new CustomEvent('cart:updated', { detail: [] }));

        if (res.skipped > 0) {
            toast(res.message || 'تم دمج السلة');
        }
    } catch (err) {
        console.warn('Cart merge failed, keeping the local cart:', err.message);
    }
};

// ---------------------------------------------------------------------------
// View switching
// ---------------------------------------------------------------------------

const showAuthView = () => {
    $('auth-view').hidden = false;
    $('dashboard-view').hidden = true;
};

const showDashboard = () => {
    $('auth-view').hidden = true;
    $('dashboard-view').hidden = false;

    $('greeting').textContent = `أهلاً ${user.name}`;
    if (user.createdAt) {
        const since = new Date(user.createdAt);
        $('member-since').textContent = `عضو منذ ${since.getFullYear()}/${String(
            since.getMonth() + 1
        ).padStart(2, '0')}/${String(since.getDate()).padStart(2, '0')}`;
    }

    $('profile-name').value = user.name || '';
    $('profile-phone').value = user.phone || '';

    renderAddresses();
    loadOrders();
};

// ---------------------------------------------------------------------------
// Auth forms
// ---------------------------------------------------------------------------

const showTab = (name) => {
    document.querySelectorAll('.auth-tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.tab === name);
    });
    $('login-form').hidden = name !== 'login';
    $('register-form').hidden = name !== 'register';
    $('login-error').hidden = true;
    $('register-error').hidden = true;
};

const setError = (id, message) => {
    const el = $(id);
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
};

const setSuccess = (id, message) => {
    const el = $(id);
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
};

const withBusy = (button, fn) => async (e) => {
    e.preventDefault();
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جارٍ المعالجة...';

    try {
        await fn();
    } finally {
        button.disabled = false;
        button.innerHTML = original;
    }
};

const handleLogin = withBusy($('login-submit'), async () => {
    setError('login-error', '');
    try {
        const res = await api('/customers/auth/login', {
            method: 'POST',
            body: {
                phone: $('login-phone').value.trim(),
                password: $('login-password').value,
            },
        });
        setToken(res.data.token);
        user = res.data;
        $('login-form').reset();
        await mergeGuestCart();
        showDashboard();
        toast(`أهلاً بعودتك ${user.name}`);
    } catch (err) {
        setError('login-error', err.message);
    }
});

const handleRegister = withBusy($('register-submit'), async () => {
    setError('register-error', '');
    try {
        const res = await api('/customers/auth/register', {
            method: 'POST',
            body: {
                name: $('reg-name').value.trim(),
                phone: $('reg-phone').value.trim(),
                password: $('reg-password').value,
                confirmPassword: $('reg-confirm').value,
            },
        });
        setToken(res.data.token);
        user = res.data;
        $('register-form').reset();
        await mergeGuestCart();
        showDashboard();
        toast('تم إنشاء حسابك بنجاح، أهلاً بك!');
    } catch (err) {
        setError('register-error', err.message);
    }
});

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

const STATUS_LABELS = {
    pending: 'قيد المراجعة',
    confirmed: 'تم التأكيد',
    preparing: 'قيد التجهيز',
    shipped: 'تم الشحن',
    delivered: 'تم التسليم',
    cancelled: 'ملغي',
};

const statusLabel = (status) => STATUS_LABELS[status] || status || 'قيد المراجعة';

const loadOrders = async () => {
    const list = $('orders-list');
    list.innerHTML = '<p class="muted" style="text-align:center;padding:2rem;">جارٍ تحميل الطلبات...</p>';

    try {
        const res = await api('/customers/orders');
        const orders = res.data || [];

        if (orders.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-box-open"></i>
                    <h3>لا توجد طلبات بعد</h3>
                    <p>ابدأ التسوق وستظهر طلباتك هنا.</p>
                    <a href="products.html" class="btn-checkout" style="display:inline-block;width:auto;padding:12px 30px;">
                        تصفح المنتجات
                    </a>
                </div>
            `;
            return;
        }

        list.innerHTML = orders
            .map(
                (order) => `
            <article class="order-card">
                <header>
                    <div>
                        <strong class="order-number">طلب #${order.orderNumber}</strong>
                        <span class="muted"> - ${new Date(order.createdAt).toLocaleDateString('ar-EG')}</span>
                    </div>
                    <span class="status-badge status-${order.status}">${statusLabel(order.status)}</span>
                </header>
                <div class="order-meta">
                    <span><i class="fa-solid fa-box"></i> ${(order.items || []).length} منتج</span>
                    <span><i class="fa-solid fa-money-bill-wave"></i> ${order.totalPrice} ج.م</span>
                    <span><i class="fa-solid fa-truck-fast"></i> ${order.shippingMethod === 'pickup' ? 'استلام من الفرع' : 'توصيل'}</span>
                </div>
                <button class="btn-outline order-details-btn" data-order="${order._id}">عرض التفاصيل</button>
            </article>
        `
            )
            .join('');

        list.querySelectorAll('.order-details-btn').forEach((btn) => {
            btn.addEventListener('click', () => showOrder(btn.dataset.order, orders));
        });
    } catch (err) {
        list.innerHTML = `<p class="form-error" style="text-align:center;">${err.message}</p>`;
    }
};

const showOrder = (id, orders) => {
    const order = orders.find((o) => o._id === id);
    if (!order) return;

    $('order-modal-body').innerHTML = `
        <h2>طلب #${order.orderNumber}</h2>
        <p class="muted">${new Date(order.createdAt).toLocaleString('ar-EG')}</p>

        <h4>المنتجات</h4>
        <div class="modal-items">
            ${(order.items || [])
                .map(
                    (item) => `
                <div class="modal-item">
                    <span>${item.name} × ${item.quantity}</span>
                    <strong>${item.totalPrice ?? item.finalPrice ?? ''} ج.م</strong>
                </div>`
                )
                .join('')}
        </div>

        <h4>بيانات التوصيل</h4>
        <p>${order.customerName} - ${order.customerPhone}</p>
        <p>${order.customerAddress}</p>
        ${order.notes ? `<p class="muted">ملاحظات: ${order.notes}</p>` : ''}

        <div class="summary-row">
            <span>الإجمالي</span>
            <strong style="color: var(--primary-color);">${order.totalPrice} ج.م</strong>
        </div>
    `;
    $('order-modal').hidden = false;
};

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

const handleProfile = async (e) => {
    e.preventDefault();
    setError('profile-error', '');
    setSuccess('profile-success', '');

    try {
        const res = await api('/customers/profile', {
            method: 'PUT',
            body: { name: $('profile-name').value.trim(), phone: $('profile-phone').value.trim() },
        });
        user = res.data;
        setSuccess('profile-success', 'تم حفظ بياناتك بنجاح');
        toast('تم تحديث بياناتك');
    } catch (err) {
        setError('profile-error', err.message);
    }
};

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

const renderAddresses = () => {
    const list = $('addresses-list');
    const addresses = user?.addresses || [];

    if (addresses.length === 0) {
        list.innerHTML = '<p class="muted" style="padding:1rem 0;">لا توجد عناوين محفوظة بعد.</p>';
        return;
    }

    list.innerHTML = addresses
        .map(
            (addr) => `
        <div class="address-card">
            <div class="address-card-head">
                <strong>${addr.label}</strong>
                ${addr.isDefault ? '<span class="status-badge">افتراضي</span>' : ''}
            </div>
            <p>${addr.line}</p>
            <p class="muted">${addr.city}</p>
            ${addr.notes ? `<p class="muted">${addr.notes}</p>` : ''}
            <div class="address-actions">
                <button class="btn-outline btn-sm" data-edit-address="${addr._id}">تعديل</button>
                <button class="btn-danger btn-sm" data-delete-address="${addr._id}">حذف</button>
            </div>
        </div>`
        )
        .join('');

    list.querySelectorAll('[data-edit-address]').forEach((btn) => {
        btn.addEventListener('click', () => startEditingAddress(btn.dataset.editAddress));
    });
    list.querySelectorAll('[data-delete-address]').forEach((btn) => {
        btn.addEventListener('click', () => deleteAddress(btn.dataset.deleteAddress));
    });
};

const resetAddressForm = () => {
    editingAddressId = null;
    $('address-form').reset();
    $('address-form-title').textContent = 'إضافة عنوان جديد';
    $('address-cancel').hidden = true;
    setError('address-error', '');
};

const startEditingAddress = (id) => {
    const addr = (user?.addresses || []).find((a) => a._id === id);
    if (!addr) return;

    editingAddressId = id;
    $('addr-label').value = addr.label || '';
    $('addr-line').value = addr.line || '';
    $('addr-city').value = addr.city || '';
    $('addr-notes').value = addr.notes || '';
    $('addr-default').checked = Boolean(addr.isDefault);
    $('address-form-title').textContent = 'تعديل العنوان';
    $('address-cancel').hidden = false;
    $('address-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
};

const handleAddressSubmit = async (e) => {
    e.preventDefault();
    setError('address-error', '');

    const body = {
        label: $('addr-label').value.trim(),
        line: $('addr-line').value.trim(),
        city: $('addr-city').value.trim(),
        notes: $('addr-notes').value.trim(),
        isDefault: $('addr-default').checked,
    };

    try {
        const res = editingAddressId
            ? await api(`/customers/addresses/${editingAddressId}`, { method: 'PUT', body })
            : await api('/customers/addresses', { method: 'POST', body });

        user.addresses = res.data;
        resetAddressForm();
        renderAddresses();
        toast(editingAddressId ? 'تم تحديث العنوان' : 'تم إضافة العنوان');
    } catch (err) {
        setError('address-error', err.message);
    }
};

const deleteAddress = async (id) => {
    if (!confirm('هل تريد حذف هذا العنوان؟')) return;

    try {
        const res = await api(`/customers/addresses/${id}`, { method: 'DELETE' });
        user.addresses = res.data;
        if (editingAddressId === id) resetAddressForm();
        renderAddresses();
        toast('تم حذف العنوان');
    } catch (err) {
        toast(err.message);
    }
};

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

const handlePassword = async (e) => {
    e.preventDefault();
    setError('password-error', '');
    setSuccess('password-success', '');

    const next = $('pw-new').value;
    if (next !== $('pw-confirm').value) {
        setError('password-error', 'كلمة المرور الجديدة وتأكيدها غير متطابقين');
        return;
    }

    try {
        await api('/customers/password', {
            method: 'PUT',
            body: { currentPassword: $('pw-current').value, newPassword: next },
        });
        $('password-form').reset();
        setSuccess('password-success', 'تم تحديث كلمة المرور بنجاح');
        toast('تم تغيير كلمة المرور');
    } catch (err) {
        setError('password-error', err.message);
    }
};

const handleDeleteAccount = async () => {
    const confirmation = prompt(
        'لتأكيد حذف الحساب نهائياً، اكتب كلمة المرور:'
    );
    if (!confirmation) return;

    try {
        await api('/customers/account', {
            method: 'DELETE',
            body: { password: confirmation },
        });
        localStorage.removeItem('abu_rabie_cart');
        setToken(null);
        user = null;
        showAuthView();
        toast('تم حذف حسابك. نتمنى أن نراك مرة أخرى.');
    } catch (err) {
        toast(err.message);
    }
};

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

let toastTimer;
const toast = (message) => {
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
};

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
    if (window.storeSettingsReady) await window.storeSettingsReady;
    document.querySelectorAll('.auth-tab').forEach((tab) => {
        tab.addEventListener('click', () => showTab(tab.dataset.tab));
    });

    document.querySelectorAll('.account-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.account-tab').forEach((t) => t.classList.remove('active'));
            document.querySelectorAll('.account-panel').forEach((p) => p.classList.remove('active'));
            tab.classList.add('active');
            document.querySelector(`.account-panel[data-panel="${tab.dataset.panel}"]`).classList.add('active');
        });
    });

    $('login-form').addEventListener('submit', handleLogin);
    $('register-form').addEventListener('submit', handleRegister);
    $('profile-form').addEventListener('submit', handleProfile);
    $('address-form').addEventListener('submit', handleAddressSubmit);
    $('password-form').addEventListener('submit', handlePassword);
    $('address-cancel').addEventListener('click', resetAddressForm);
    $('logout-btn').addEventListener('click', () => signOut());
    $('delete-account-btn').addEventListener('click', handleDeleteAccount);
    $('order-modal-close').addEventListener('click', () => ($('order-modal').hidden = true));
    $('order-modal').addEventListener('click', (e) => {
        if (e.target === $('order-modal')) $('order-modal').hidden = true;
    });

    if (!token) {
        showAuthView();
        return;
    }

    try {
        const res = await api('/customers/auth/me');
        user = res.data;
        showDashboard();
    } catch {
        setToken(null);
        showAuthView();
    }
});
