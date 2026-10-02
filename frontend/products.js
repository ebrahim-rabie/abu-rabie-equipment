/**
 * Catalogue browsing and the guest shopping cart.
 *
 * The catalogue is paginated and filtered by the API rather than in the
 * browser. The previous version downloaded the first 100 products once and
 * filtered them client-side, so 700+ of the imported products were unreachable
 * and a search could only ever match what happened to be on page 1.
 */
const API_URL =
    window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
        ? (window.location.port === '5000' ? '/api' : 'http://localhost:5000/api')
        : '/api';

const PAGE_SIZE = 24;

const state = {
    products: [],
    categories: [],
    brands: [],
    page: 1,
    totalPages: 1,
    total: 0,
    category: 'all',
    brand: 'all',
    sort: '',
    search: '',
    loading: false,
    showPrices: true,
};

// Products are cached across page changes so the cart can still resolve a
// product the user added earlier and is no longer on screen.
const productCache = new Map();
let cartFocusReturn = null;

let cart = JSON.parse(localStorage.getItem('abu_rabie_cart') || '[]');

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    if (window.storeSettingsReady) await window.storeSettingsReady;
    state.showPrices = window.storeSettings?.showPrices !== false;
    setupCartUI();
    setupEventListeners();
    await loadCategories();
    await loadProducts();
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function loadCategories() {
    try {
        const res = await fetch(`${API_URL}/categories`);
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
            state.categories = json.data.filter((c) => c.isActive !== false);
        }
    } catch (err) {
        console.warn('Could not load categories:', err.message);
    }
    renderCategories();
    renderBrandFilter();
}

async function loadProducts() {
    const grid = document.querySelector('.products-grid');
    if (!grid) return;

    state.loading = true;
    renderLoading();

    const params = new URLSearchParams({
        page: String(state.page),
        limit: String(PAGE_SIZE),
    });
    if (state.category !== 'all') params.set('category', state.category);
    if (state.brand !== 'all') params.set('brand', state.brand);
    if (state.sort) params.set('sort', state.sort);
    if (state.search) params.set('search', state.search);

    try {
        const res = await fetch(`${API_URL}/products?${params.toString()}`);
        const json = await res.json();

        if (!json.success) throw new Error(json.message || 'Request failed');

        state.products = json.data || [];
        state.total = json.total || 0;
        state.totalPages = json.totalPages || 1;
        if (Array.isArray(json.brands)) state.brands = json.brands;

        state.products.forEach((p) => productCache.set(String(p._id), p));

        // A search or filter can shrink the result set out from under the
        // current page, so fall back to the last page that still has results.
        if (state.page > state.totalPages) {
            state.page = state.totalPages || 1;
            return loadProducts();
        }

        renderProducts();
        renderPagination();
        renderResultsCount();
    } catch (err) {
        console.error('Failed to load products:', err);
        state.products = [];
        renderError(err.message);
    } finally {
        state.loading = false;
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderLoading() {
    const grid = document.querySelector('.products-grid');
    if (!grid) return;
    grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 4rem;">
            <i class="fa-solid fa-spinner fa-spin" style="font-size: 3rem; color: var(--primary-color); margin-bottom: 1rem;"></i>
            <h3>جاري تحميل أحدث المعدات وقطع الغيار...</h3>
        </div>
    `;
}

function renderError(message) {
    const grid = document.querySelector('.products-grid');
    if (!grid) return;
    grid.innerHTML = `
        <div class="product-card placeholder-card" style="grid-column: 1 / -1; padding: 4rem;">
            <i class="fa-solid fa-triangle-exclamation" style="font-size: 3rem; color: var(--primary-color); margin-bottom: 1rem;"></i>
            <h3>تعذر تحميل المنتجات حالياً</h3>
            <p>${escapeHtml(message || '')}</p>
            <p>يرجى التأكد من الاتصال بالإنترنت والمحاولة مرة أخرى.</p>
            <button type="button" class="btn-product btn-cart" data-retry-products style="margin-top:1rem;">
                <i class="fa-solid fa-rotate-right"></i> إعادة المحاولة
            </button>
        </div>
    `;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[c]));
}

function renderCategories() {
    const container = document.querySelector('.categories-filter');
    if (!container) return;

    const options = [
        { value: 'all', label: 'الكل', count: null },
        ...state.categories.map((c) => ({
            value: c.slug || c._id,
            label: c.name,
            count: c.productCount,
        })),
    ];

    container.innerHTML = options
        .map((opt) => {
            const active = opt.value === state.category ? 'active' : '';
            const count =
                typeof opt.count === 'number'
                    ? `<span class="filter-count">${opt.count}</span>`
                    : '';
            return `<button type="button" class="filter-btn ${active}" data-cat="${escapeHtml(opt.value)}">
                ${escapeHtml(opt.label)}${count}
            </button>`;
        })
        .join('');

    container.querySelectorAll('.filter-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            state.category = btn.dataset.cat;
            state.page = 1;
            container.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            renderBrandFilter();
            loadProducts();
        });
    });
}

function renderBrandFilter() {
    const container = document.querySelector('#brand-filter');
    if (!container) return;

    if (!state.brands.length) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = `
        <label for="brand-select" style="font-size: 0.9rem; color: var(--text-grey);">الماركة</label>
        <select id="brand-select" class="cart-input" style="max-width: 220px;">
            <option value="all">كل الماركات</option>
            ${state.brands
                .map(
                    (b) =>
                        `<option value="${escapeHtml(b)}" ${b === state.brand ? 'selected' : ''}>${escapeHtml(b)}</option>`
                )
                .join('')}
        </select>
    `;

    const select = container.querySelector('#brand-select');
    select.addEventListener('change', () => {
        state.brand = select.value;
        state.page = 1;
        loadProducts();
    });
}

function renderResultsCount() {
    const el = document.getElementById('results-count');
    if (!el) return;

    if (state.total === 0) {
        el.textContent = '';
        return;
    }

    const from = (state.page - 1) * PAGE_SIZE + 1;
    const to = Math.min(state.page * PAGE_SIZE, state.total);
    el.textContent = `عرض ${from} - ${to} من ${state.total} منتج`;
}

function renderProducts() {
    const grid = document.querySelector('.products-grid');
    if (!grid) return;

    if (state.products.length === 0) {
        grid.innerHTML = `
            <div class="product-card placeholder-card" style="grid-column: 1 / -1; padding: 4rem;">
                <i class="fa-solid fa-box-open" style="font-size: 3rem; color: var(--primary-color); margin-bottom: 1rem;"></i>
                <h3>لا توجد منتجات مطابقة للبحث</h3>
                <p>جرب البحث بكلمة أخرى أو تصفح باقي الأقسام.</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = state.products.map((p) => {
        const hasDiscount = p.salePrice && p.price && p.salePrice < p.price;
        const currentPrice = hasDiscount ? p.salePrice : p.price;
        const discountPct =
            p.discountPct ||
            (hasDiscount ? Math.round(((p.price - p.salePrice) / p.price) * 100) : 0);

        const waMsg = `السلام عليكم م/ محمد، أود الاستفسار وطلب:\n- ${p.name}\n- الكود: ${p.sku || 'N/A'}${state.showPrices ? `\n- السعر: ${currentPrice} ج.م` : ''}\nالرابط: ${window.location.href}`;
        const waUrl = `https://wa.me/201093044150?text=${encodeURIComponent(waMsg)}`;

        const categoryLabel = p.categoryName || (p.category && p.category.name) || 'معدات';

        return `
            <div class="product-card" data-id="${escapeHtml(p._id)}">
                <div class="product-img">
                    ${state.showPrices && discountPct > 0 ? `<span class="discount-badge customer-discount">خصم ${discountPct}%</span>` : ''}
                    ${!p.inStock ? '<span class="out-of-stock-badge">غير متوفر</span>' : ''}
                    <a class="product-image-link" href="product.html?slug=${encodeURIComponent(p.slug || p._id)}" aria-label="تفاصيل ${escapeHtml(p.name)}">
                        <img src="${escapeHtml(p.image || 'assets/logo.jpg')}" alt="${escapeHtml(p.name)}"
                            loading="lazy" data-fallback-src="assets/logo.jpg">
                    </a>
                </div>
                <div class="product-info">
                    <div class="product-meta">
                        <span class="category">${escapeHtml(p.brand || 'أصلي')} | ${escapeHtml(categoryLabel)}</span>
                        ${p.sku ? `<span class="sku-tag">كود: ${escapeHtml(p.sku)}</span>` : ''}
                    </div>
                    <h3><a class="product-title-link" href="product.html?slug=${encodeURIComponent(p.slug || p._id)}">${escapeHtml(p.name)}</a></h3>
                    <div class="price-container customer-price">
                        ${hasDiscount ? `<span class="old-price">${p.price} ج.م</span>` : ''}
                        <span class="price">${currentPrice} ج.م</span>
                    </div>
                    <div class="product-actions">
                        <button type="button" class="btn-product btn-cart" data-add-to-cart="${escapeHtml(p._id)}"
                            ${p.inStock ? '' : 'disabled'}>
                            <i class="fa-solid fa-cart-plus"></i> ${p.inStock ? 'إضافة للسلة' : 'غير متوفر'}
                        </button>
                        <a href="${waUrl}" target="_blank" rel="noopener" class="btn-product btn-whatsapp"
                            title="طلب مباشر عبر واتساب">
                            <i class="fa-brands fa-whatsapp"></i> واتساب
                        </a>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    grid.querySelectorAll('img[data-fallback-src]').forEach((image) => {
        image.addEventListener('error', () => {
            image.src = image.dataset.fallbackSrc;
        }, { once: true });
    });

    grid.querySelectorAll('[data-add-to-cart]').forEach((btn) => {
        btn.addEventListener('click', () => addToCart(btn.dataset.addToCart));
    });
}

function renderPagination() {
    const container = document.getElementById('pagination');
    if (!container) return;

    if (state.totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    const { page, totalPages } = state;

    // A compact window keeps the control usable on a 35-page catalogue
    const windowSize = 2;
    const pages = [];
    for (let i = 1; i <= totalPages; i += 1) {
        if (i === 1 || i === totalPages || Math.abs(i - page) <= windowSize) {
            pages.push(i);
        }
    }

    const buttons = pages
        .map((p, idx) => {
            if (idx > 0 && p - pages[idx - 1] > 1) {
                return '<span class="page-gap">...</span>';
            }
            return `<button type="button" class="page-btn ${p === page ? 'active' : ''}" data-page="${p}">${p}</button>`;
        })
        .join('');

    container.innerHTML = `
        <button type="button" class="page-btn" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''} title="السابق" aria-label="الصفحة السابقة">
            <i class="fa-solid fa-chevron-right"></i>
        </button>
        ${buttons}
        <button type="button" class="page-btn" data-page="${page + 1}" ${page === totalPages ? 'disabled' : ''} title="التالي" aria-label="الصفحة التالية">
            <i class="fa-solid fa-chevron-left"></i>
        </button>
    `;

    container.querySelectorAll('.page-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const next = Number(btn.dataset.page);
            if (!next || next < 1 || next > state.totalPages || next === state.page) return;
            state.page = next;
            loadProducts();
            document.querySelector('.page-header')?.scrollIntoView({ behavior: 'smooth' });
        });
    });
}

// ---------------------------------------------------------------------------
// Shopping cart
// ---------------------------------------------------------------------------

function addToCart(productId) {
    const key = String(productId);
    // The card may come from an earlier page, so fall back to the cache
    const product = productCache.get(key);
    if (!product) return;

    const existing = cart.find((item) => item.id === key);
    if (existing) {
        existing.quantity += 1;
    } else {
        cart.push({
            id: key,
            name: product.name,
            sku: product.sku || '',
            price: product.salePrice || product.price,
            image: product.image || 'assets/logo.jpg',
            quantity: 1,
        });
    }

    saveCart();
    updateCartBadge();
    openCartModal();
}

function updateCartQuantity(id, delta) {
    const item = cart.find((i) => i.id === id);
    if (!item) return;

    item.quantity += delta;
    if (item.quantity <= 0) {
        cart = cart.filter((i) => i.id !== id);
    }
    saveCart();
    renderCartItems();
    updateCartBadge();
}

function removeFromCart(id) {
    cart = cart.filter((i) => i.id !== id);
    saveCart();
    renderCartItems();
    updateCartBadge();
}

function saveCart() {
    localStorage.setItem('abu_rabie_cart', JSON.stringify(cart));
    window.dispatchEvent(new CustomEvent('cart:updated', { detail: cart }));
}

function updateCartBadge() {
    const badge = document.getElementById('cart-count');
    const totalCount = cart.reduce((sum, item) => sum + item.quantity, 0);
    if (badge) {
        badge.textContent = totalCount;
        badge.style.display = totalCount > 0 ? 'inline-block' : 'none';
        document.getElementById('floating-cart-btn')?.setAttribute(
            'aria-label',
            totalCount ? `فتح السلة، ${totalCount} منتجات` : 'فتح سلة المشتريات'
        );
    }
}

// Setup Cart UI (Floating button and Checkout drawer)
function setupCartUI() {
    const cartButton = document.createElement('button');
    cartButton.id = 'floating-cart-btn';
    cartButton.className = 'floating-cart';
    cartButton.type = 'button';
    cartButton.setAttribute('aria-label', 'فتح سلة المشتريات');
    cartButton.innerHTML = `
        <i class="fa-solid fa-cart-shopping"></i>
        <span id="cart-count" class="cart-badge" style="display: none;">0</span>
    `;
    document.body.appendChild(cartButton);

    cartButton.addEventListener('click', openCartModal);

    const cartModal = document.createElement('div');
    cartModal.id = 'cart-modal';
    cartModal.className = 'cart-modal';
    cartModal.setAttribute('aria-label', 'سلة المشتريات');
    cartModal.innerHTML = `
        <section class="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cart-modal-title" tabindex="-1">
            <div class="cart-header">
                <h3 id="cart-modal-title"><i class="fa-solid fa-cart-shopping" style="color: var(--primary-color);"></i> سلة المشتريات</h3>
                <button type="button" class="cart-close" id="close-cart-btn" aria-label="إغلاق السلة">&times;</button>
            </div>
            <div class="cart-items" id="cart-items-container"></div>
            <div class="cart-summary">
                <div class="summary-row">
                    <span>الإجمالي التقديري:</span>
                    <strong id="cart-total" class="customer-price" style="color: var(--primary-color); font-size: 1.3rem;">0 ج.م</strong>
                </div>
                <form id="checkout-form" class="checkout-form">
                    <h4>بيانات التوصيل والطلب:</h4>
                    <input type="text" id="cust-name" required placeholder="الاسم ثلاثي *" class="cart-input">
                    <input type="tel" id="cust-phone" required placeholder="رقم الهاتف للتواصل *" class="cart-input">
                    <input type="text" id="cust-address" required placeholder="العنوان بالتفصيل والمدينة *" class="cart-input">
                    <textarea id="cust-notes" placeholder="ملاحظات إضافية على الطلب..." class="cart-input" rows="2"></textarea>
                    <button type="submit" class="btn-checkout">
                        <i class="fa-brands fa-whatsapp"></i> إتمام الطلب عبر واتساب
                    </button>
                </form>
            </div>
        </section>
    `;
    document.body.appendChild(cartModal);

    document.getElementById('close-cart-btn').addEventListener('click', closeCartModal);
    cartModal.addEventListener('click', (e) => {
        if (e.target === cartModal) closeCartModal();
    });
    cartModal.addEventListener('keydown', (event) => {
        if (event.key !== 'Tab') return;
        const focusable = [...cartModal.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href]')];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });
    document.getElementById('checkout-form').addEventListener('submit', handleCheckout);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeCartModal();
    });

    updateCartBadge();
}

function openCartModal(event) {
    renderCartItems();
    const modal = document.getElementById('cart-modal');
    cartFocusReturn = event?.currentTarget || document.activeElement;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    modal.querySelector('.cart-close')?.focus();
}

function closeCartModal() {
    const modal = document.getElementById('cart-modal');
    if (!modal?.classList.contains('active')) return;
    modal.classList.remove('active');
    document.body.style.overflow = '';
    if (cartFocusReturn?.isConnected) cartFocusReturn.focus();
    cartFocusReturn = null;
}

function renderCartItems() {
    const container = document.getElementById('cart-items-container');
    const totalEl = document.getElementById('cart-total');

    if (cart.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--text-grey);">
                <i class="fa-solid fa-basket-shopping" style="font-size: 2.5rem; margin-bottom: 1rem;"></i>
                <p>سلتك فارغة حالياً. تصفح المنتجات وأضف ما تحتاجه!</p>
            </div>
        `;
        totalEl.textContent = '0 ج.م';
        return;
    }

    let total = 0;
    container.innerHTML = cart
        .map((item) => {
            const itemTotal = item.price * item.quantity;
            total += itemTotal;
            return `
            <div class="cart-item">
                <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}">
                <div class="item-details">
                    <h4>${escapeHtml(item.name)}</h4>
                    <span class="item-price customer-price">${item.price} ج.م</span>
                    <div class="qty-controls">
                        <button type="button" data-cart-delta="-1" data-id="${escapeHtml(item.id)}" aria-label="تقليل كمية ${escapeHtml(item.name)}">-</button>
                        <span>${item.quantity}</span>
                        <button type="button" data-cart-delta="1" data-id="${escapeHtml(item.id)}" aria-label="زيادة كمية ${escapeHtml(item.name)}">+</button>
                    </div>
                </div>
                <button type="button" class="remove-btn" data-cart-remove="${escapeHtml(item.id)}" title="حذف" aria-label="حذف ${escapeHtml(item.name)}">&times;</button>
            </div>
        `;
        })
        .join('');

    container.querySelectorAll('[data-cart-delta]').forEach((btn) => {
        btn.addEventListener('click', () =>
            updateCartQuantity(btn.dataset.id, Number(btn.dataset.cartDelta))
        );
    });
    container.querySelectorAll('[data-cart-remove]').forEach((btn) => {
        btn.addEventListener('click', () => removeFromCart(btn.dataset.cartRemove));
    });

    totalEl.textContent = state.showPrices ? `${total} ج.م` : '';
}

// Handle Order Checkout
async function handleCheckout(e) {
    e.preventDefault();
    if (localStorage.getItem('abu_rabie_token')) {
        window.location.href = 'cart.html';
        return;
    }
    if (cart.length === 0) {
        alert('سلة المشتريات فارغة');
        return;
    }

    const customerName = document.getElementById('cust-name').value;
    const customerPhone = document.getElementById('cust-phone').value;
    const customerAddress = document.getElementById('cust-address').value;
    const notes = document.getElementById('cust-notes').value;

    // Only the product ids and quantities are trusted. The server reloads each
    // product and computes the price itself, so a tampered cart cannot change
    // what is charged.
    const payload = {
        customerName,
        customerPhone,
        customerAddress,
        items: cart.map((i) => ({
            productId: i.id,
            name: i.name,
            sku: i.sku,
            price: i.price,
            quantity: i.quantity,
            image: i.image,
        })),
        notes,
    };

    const submitBtn = e.target.querySelector('.btn-checkout');
    const originalHtml = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الإرسال...';

    let whatsappUrl = null;
    let saved = false;

    try {
        const res = await fetch(`${API_URL}/orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const json = await res.json();

        if (json.success && json.whatsappUrl) {
            whatsappUrl = json.whatsappUrl;
            saved = true;
        } else if (!json.success) {
            throw new Error(json.message || 'تعذر تسجيل الطلب');
        }
    } catch (err) {
        console.warn('Order was not saved to the database:', err.message);
    }

    submitBtn.disabled = false;
    submitBtn.innerHTML = originalHtml;

    // Fall back to a direct WhatsApp link if the database was unreachable
    if (!whatsappUrl) {
        const total = cart.reduce((s, i) => s + i.price * i.quantity, 0);
        const itemsList = cart
            .map((i, idx) => `${idx + 1}. *${i.name}* (${i.quantity} × ${i.price} ج.م)`)
            .join('\n');
        const text = `🛠️ *طلب شراء جديد - مركز أبو ربيع للمعدات* 🛠️\n\n👤 *العميل:* ${customerName}\n📞 *الهاتف:* ${customerPhone}\n📍 *العنوان:* ${customerAddress}\n\n🛒 *المنتجات:*\n${itemsList}\n\n💰 *الإجمالي:* ${total} ج.م\n${notes ? `📝 *ملاحظات:* ${notes}` : ''}`;
        whatsappUrl = `https://wa.me/201093044150?text=${encodeURIComponent(text)}`;
    }

    if (saved) {
        cart = [];
        saveCart();
        updateCartBadge();
    }

    closeCartModal();
    window.location.assign(whatsappUrl);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function setupEventListeners() {
    document.addEventListener('click', (event) => {
        if (event.target.closest('[data-retry-products]')) loadProducts();
    });
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        // Debounced so a fast typist does not fire a request per keystroke
        let timer;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                state.search = e.target.value.trim();
                state.page = 1;
                loadProducts();
            }, 350);
        });
    }

    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) {
        sortSelect.addEventListener('change', () => {
            state.sort = sortSelect.value;
            state.page = 1;
            loadProducts();
        });
    }
}
