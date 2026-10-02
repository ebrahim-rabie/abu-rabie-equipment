(() => {
    const CART_KEY = 'abu_rabie_cart';
    let accountCount = 0;
    const apiBase = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
        ? (window.location.port === '5000' ? '/api' : 'http://localhost:5000/api')
        : '/api';

    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
    const money = (value) => `${Number(value || 0).toLocaleString('en-EG')} ج.م`;

    const readCart = () => {
        try {
            const value = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
            return Array.isArray(value) ? value.filter((item) => item && item.id) : [];
        } catch {
            return [];
        }
    };

    const writeCart = (cart) => {
        localStorage.setItem(CART_KEY, JSON.stringify(cart));
        updateBadge(cart);
        window.dispatchEvent(new CustomEvent('cart:updated', { detail: cart }));
    };

    const updateBadge = (cart = readCart()) => {
        const localCount = cart.reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0), 0);
        const count = localCount + accountCount;
        document.querySelectorAll('.nav-cart-count').forEach((badge) => { badge.textContent = String(count); });
    };

    const customerToken = () => localStorage.getItem('abu_rabie_token');

    const accountRequest = async (path, { method = 'GET', body } = {}) => {
        const token = customerToken();
        if (!token) throw new Error('سجّل الدخول أولاً لاستخدام سلة الحساب.');
        const response = await fetch(`${apiBase}${path}`, {
            method,
            headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || 'تعذر تحديث سلة الحساب.');
        accountCount = Number(result.count) || 0;
        return result;
    };

    const fromAccountItems = (items = []) => items.map((item) => ({
        id: String(item.productId),
        name: item.name,
        sku: item.sku || '',
        price: Number(item.price) || 0,
        image: item.image || 'assets/logo.jpg',
        quantity: Number(item.quantity) || 1,
    }));

    const refreshAccountBadge = async () => {
        if (!customerToken()) return;
        try {
            const result = await accountRequest('/customers/cart');
            updateBadge();
            return result;
        } catch {
            accountCount = 0;
            updateBadge();
        }
    };

    const initCartPage = async () => {
        if (window.storeSettingsReady) await window.storeSettingsReady;
        const list = document.getElementById('cart-page-items');
        if (!list) return;
        const total = document.getElementById('cart-page-total');
        const form = document.getElementById('cart-checkout-form');
        const status = document.getElementById('cart-checkout-status');
        const submit = document.getElementById('cart-submit');
        let cart = readCart();
        let accountMode = false;

        const render = () => {
            if (!accountMode) cart = readCart();
            updateBadge(accountMode ? [] : cart);
            const amount = cart.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0), 0);
            total.textContent = money(amount);

            if (!cart.length) {
                list.innerHTML = '<div class="cart-empty"><i class="fa-solid fa-cart-shopping"></i><strong>سلتك فارغة</strong><p>أضف منتجات من المتجر لتظهر هنا.</p><a href="products.html">تصفح المنتجات</a></div>';
                submit.disabled = true;
                return;
            }
            submit.disabled = false;
            list.innerHTML = cart.map((item) => `
                <article class="cart-page-item">
                    <img src="${escapeHtml(item.image || 'assets/logo.jpg')}" alt="${escapeHtml(item.name)}" data-fallback-src="assets/logo.jpg">
                    <div>
                        <h3>${escapeHtml(item.name)}</h3>
                        <p>${money(item.price)} للقطعة${item.sku ? ` · كود ${escapeHtml(item.sku)}` : ''}</p>
                        <div class="cart-page-controls" aria-label="تعديل الكمية">
                            <button type="button" data-cart-step="1" data-id="${escapeHtml(item.id)}" aria-label="زيادة الكمية">+</button>
                            <span>${Math.max(1, Number(item.quantity) || 1)}</span>
                            <button type="button" data-cart-step="-1" data-id="${escapeHtml(item.id)}" aria-label="تقليل الكمية">−</button>
                            <button type="button" class="cart-remove" data-cart-remove="${escapeHtml(item.id)}" aria-label="حذف ${escapeHtml(item.name)}">حذف</button>
                        </div>
                    </div>
                    <strong class="cart-line-total customer-price">${money((Number(item.price) || 0) * (Number(item.quantity) || 0))}</strong>
                </article>
            `).join('');

            list.querySelectorAll('img[data-fallback-src]').forEach((image) => {
                image.addEventListener('error', () => {
                    image.src = image.dataset.fallbackSrc;
                }, { once: true });
            });

            list.querySelectorAll('[data-cart-step]').forEach((button) => button.addEventListener('click', async () => {
                const id = button.dataset.id;
                const step = Number(button.dataset.cartStep);
                if (accountMode) {
                    const item = cart.find((entry) => entry.id === id);
                    if (!item) return;
                    try {
                        const result = await accountRequest(`/customers/cart/${encodeURIComponent(id)}`, {
                            method: 'PUT', body: { quantity: Math.min(99, Math.max(0, item.quantity + step)) },
                        });
                        cart = fromAccountItems(result.data?.items);
                        render();
                    } catch (error) { status.textContent = error.message; }
                    return;
                }
                cart = readCart().map((item) => item.id === id
                    ? { ...item, quantity: Math.min(99, Math.max(0, Number(item.quantity || 1) + step)) }
                    : item).filter((item) => item.quantity > 0);
                writeCart(cart);
                render();
            }));
            list.querySelectorAll('[data-cart-remove]').forEach((button) => button.addEventListener('click', async () => {
                if (accountMode) {
                    try {
                        const result = await accountRequest(`/customers/cart/${encodeURIComponent(button.dataset.cartRemove)}`, { method: 'DELETE' });
                        cart = fromAccountItems(result.data?.items);
                        render();
                    } catch (error) { status.textContent = error.message; }
                    return;
                }
                writeCart(readCart().filter((item) => item.id !== button.dataset.cartRemove));
                render();
            }));
        };

        const loadCart = async () => {
            if (!customerToken()) { render(); return; }
            accountMode = true;
            try {
                const guestItems = readCart();
                if (guestItems.length) {
                    await accountRequest('/customers/cart/merge', {
                        method: 'POST',
                        body: { items: guestItems.map((item) => ({ id: item.id, quantity: item.quantity })) },
                    });
                    localStorage.removeItem(CART_KEY);
                    window.dispatchEvent(new CustomEvent('cart:updated', { detail: [] }));
                }
                const result = await accountRequest('/customers/cart');
                cart = fromAccountItems(result.data?.items);
                render();
            } catch (error) {
                accountMode = false;
                status.textContent = `${error.message} يمكنك تسجيل الدخول من صفحة الحساب ثم العودة للسلة.`;
                render();
            }
        };

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!accountMode) cart = readCart();
            if (!cart.length) return;
            status.textContent = '';
            submit.disabled = true;
            submit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جارٍ تسجيل الطلب...';
            const fields = new FormData(form);
            const token = customerToken();
            try {
                const response = await fetch(`${apiBase}/orders`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                    body: JSON.stringify({
                        customerName: fields.get('customerName'),
                        customerPhone: fields.get('customerPhone'),
                        customerAddress: fields.get('customerAddress'),
                        notes: fields.get('notes'),
                        items: cart.map((item) => ({ productId: item.id, quantity: item.quantity })),
                    }),
                });
                const result = await response.json();
                if (!response.ok || !result.success) throw new Error(result.message || 'تعذر تسجيل الطلب');

                const orderNumber = result.data?.orderNumber || '';
                let cartClearWarning = '';
                if (accountMode) {
                    try { await accountRequest('/customers/cart', { method: 'DELETE' }); } catch (error) {
                        cartClearWarning = `لم يتم تحديث سلة حسابك: ${error.message}`;
                    }
                    cart = [];
                    accountCount = 0;
                } else {
                    writeCart([]);
                }
                render();
                form.reset();
                status.innerHTML = `<p>تم تسجيل طلبك بنجاح${orderNumber ? `، رقم الطلب: <strong>${escapeHtml(orderNumber)}</strong>` : ''}.</p>${cartClearWarning ? `<p>${escapeHtml(cartClearWarning)}</p>` : ''}${result.whatsappUrl ? `<a href="${escapeHtml(result.whatsappUrl)}" target="_blank" rel="noopener">إرسال تفاصيل الطلب عبر واتساب</a>` : ''}`;
            } catch (error) {
                status.textContent = error.message || 'حدث خطأ أثناء تسجيل الطلب.';
            } finally {
                submit.disabled = (accountMode ? cart : readCart()).length === 0;
                submit.innerHTML = '<i class="fa-solid fa-check"></i> تأكيد الطلب';
            }
        });

        window.addEventListener('cart:updated', () => { updateBadge(); refreshAccountBadge(); if (!accountMode) render(); });
        window.addEventListener('storage', (event) => { if (event.key === CART_KEY) render(); });
        loadCart();
    };

    document.addEventListener('DOMContentLoaded', () => {
        updateBadge();
        refreshAccountBadge();
        initCartPage();
    });
    window.addEventListener('cart:updated', (event) => updateBadge(event.detail));
    window.addEventListener('cart:updated', refreshAccountBadge);
})();
