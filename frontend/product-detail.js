(() => {
    const API_BASE = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
        ? (window.location.port === '5000' ? '/api' : 'http://localhost:5000/api')
        : '/api';

    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
    const formatPrice = (value) => Number(value || 0).toLocaleString('en-EG');
    const imageFallback = 'assets/logo.jpg';

    const renderSpecifications = (specs) => {
        if (!specs || typeof specs !== 'object' || Array.isArray(specs)) return '';
        const entries = Object.entries(specs).filter(([, value]) => value !== null && value !== undefined && String(value).trim());
        if (!entries.length) return '';
        return `
            <section class="product-specifications">
                <h2>المواصفات</h2>
                <table><tbody>${entries.map(([key, value]) => `
                    <tr><th scope="row">${escapeHtml(key)}</th><td>${escapeHtml(typeof value === 'object' ? JSON.stringify(value) : value)}</td></tr>
                `).join('')}</tbody></table>
            </section>
        `;
    };

    const renderProduct = (product) => {
        const root = document.getElementById('product-detail');
        const state = document.getElementById('product-detail-state');
        const images = [...new Set([product.image, ...(Array.isArray(product.images) ? product.images : [])].filter(Boolean))];
        const initialImage = images[0] || imageFallback;
        const sale = Number(product.salePrice) > 0 && Number(product.salePrice) < Number(product.price);
        const currentPrice = sale ? product.salePrice : product.price;
        const discount = Number(product.discountPct) || (sale ? Math.round((1 - product.salePrice / product.price) * 100) : 0);
        const category = product.categoryName || product.category?.name || 'معدات';
        const stock = Boolean(product.inStock);
        const message = `السلام عليكم، أود الاستفسار عن المنتج: ${product.name} - الكود: ${product.sku || 'غير متوفر'}`;
        const waUrl = `https://wa.me/201093044150?text=${encodeURIComponent(message)}`;

        root.innerHTML = `
            <section class="product-gallery" aria-label="صور المنتج">
                <div class="product-main-image"><img id="product-main-image" src="${escapeHtml(initialImage)}" alt="${escapeHtml(product.name)}" data-fallback-src="${imageFallback}"></div>
                ${images.length > 1 ? `<div class="product-thumbnails">${images.map((image, index) => `
                    <button class="product-thumbnail" type="button" data-image="${escapeHtml(image)}" aria-label="عرض صورة المنتج ${index + 1}" aria-pressed="${index === 0}"><img src="${escapeHtml(image)}" alt="" data-fallback-src="${imageFallback}"></button>
                `).join('')}</div>` : ''}
            </section>
            <section class="product-detail-info">
                <div class="product-detail-eyebrow">
                    <span class="product-detail-chip brand">${escapeHtml(product.brand || 'أصلي')}</span>
                    <span class="product-detail-chip">${escapeHtml(category)}</span>
                </div>
                <h1 class="product-detail-title">${escapeHtml(product.name)}</h1>
                ${product.sku ? `<p class="product-detail-sku">كود المنتج: ${escapeHtml(product.sku)}</p>` : ''}
                <div class="product-detail-price">
                    <strong class="product-detail-current-price">${formatPrice(currentPrice)} <small>ج.م</small></strong>
                    ${sale ? `<span class="product-detail-old-price">${formatPrice(product.price)} ج.م</span><span class="product-detail-discount">خصم ${discount}%</span>` : ''}
                </div>
                <p class="product-detail-stock ${stock ? '' : 'unavailable'}"><i class="fa-solid ${stock ? 'fa-circle-check' : 'fa-circle-xmark'}"></i> ${stock ? 'متوفر للطلب' : 'غير متوفر حالياً'}</p>
                ${product.description ? `<p class="product-detail-description">${escapeHtml(product.description)}</p>` : ''}
                <div class="product-detail-order">
                    <label class="product-detail-quantity"><span>الكمية</span><input id="product-quantity" type="number" min="1" max="99" value="1" ${stock ? '' : 'disabled'}></label>
                    <button id="product-add-to-cart" class="product-detail-add" type="button" ${stock ? '' : 'disabled'}><i class="fa-solid fa-cart-plus"></i> أضف إلى السلة</button>
                    <a class="product-detail-whatsapp" href="${waUrl}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i> اسأل عبر واتساب</a>
                </div>
                <p id="product-detail-feedback" class="product-detail-feedback" role="status" aria-live="polite"></p>
            </section>
            ${renderSpecifications(product.specs)}
        `;
        root.hidden = false;
        state.hidden = true;

        root.querySelectorAll('img[data-fallback-src]').forEach((image) => {
            image.addEventListener('error', () => {
                image.src = image.dataset.fallbackSrc;
            }, { once: true });
        });

        root.querySelectorAll('[data-image]').forEach((button) => button.addEventListener('click', () => {
            document.getElementById('product-main-image').src = button.dataset.image;
            root.querySelectorAll('[data-image]').forEach((thumbnail) => thumbnail.setAttribute('aria-pressed', String(thumbnail === button)));
        }));

        document.getElementById('product-add-to-cart').addEventListener('click', () => {
            let cart = [];
            try { cart = JSON.parse(localStorage.getItem('abu_rabie_cart') || '[]'); } catch { cart = []; }
            if (!Array.isArray(cart)) cart = [];
            const id = String(product._id);
            const quantity = Math.min(99, Math.max(1, Number(document.getElementById('product-quantity').value) || 1));
            const existing = cart.find((item) => String(item.id) === id);
            if (existing) existing.quantity = Math.min(99, Number(existing.quantity || 0) + quantity);
            else cart.push({ id, name: product.name, sku: product.sku || '', price: currentPrice, image: initialImage, quantity });
            localStorage.setItem('abu_rabie_cart', JSON.stringify(cart));
            window.dispatchEvent(new CustomEvent('cart:updated', { detail: cart }));
            document.getElementById('product-detail-feedback').innerHTML = 'تمت إضافة المنتج إلى السلة. <a href="cart.html">عرض السلة</a>';
        });
    };

    const init = async () => {
        const state = document.getElementById('product-detail-state');
        const slug = new URLSearchParams(window.location.search).get('slug');
        if (!slug) {
            state.textContent = 'رابط المنتج غير مكتمل. ارجع إلى صفحة المنتجات واختر منتجاً.';
            state.classList.add('is-error');
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/products/${encodeURIComponent(slug)}`);
            const result = await response.json();
            if (!response.ok || !result.success || !result.data) throw new Error(result.message || 'تعذر العثور على المنتج.');
            document.title = `${result.data.name} | مركز أبو ربيع`;
            renderProduct(result.data);
        } catch (error) {
            state.textContent = error.message || 'تعذر تحميل المنتج. حاول مرة أخرى.';
            state.classList.add('is-error');
        }
    };

    document.addEventListener('DOMContentLoaded', init);
})();
