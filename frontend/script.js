document.addEventListener('DOMContentLoaded', () => {
    // Do not leave the homepage's initial loading placeholder on screen if the
    // API script cannot load or the backend is offline.
    const homeProducts = document.getElementById('home-featured-products');
    if (homeProducts) {
        window.setTimeout(() => {
            const stillLoading = homeProducts.querySelector('.fa-spinner');
            if (stillLoading) {
                homeProducts.innerHTML = '<p class="home-products-state">تعذر تحميل المنتجات الآن. <a href="products.html">تصفح جميع المنتجات</a></p>';
            }
        }, 7000);

        const apiBase = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
            ? (window.location.port === '5000' ? '/api' : 'http://localhost:5000/api')
            : '/api';
        const loadHomeProducts = async () => {
            if (window.storeSettingsReady) await window.storeSettingsReady;
            const showPrices = window.storeSettings?.showPrices !== false;
            const controller = new AbortController();
            const timeout = window.setTimeout(() => controller.abort(), 6500);
            try {
                const response = await fetch(`${apiBase}/products/featured?limit=4`, { signal: controller.signal });
                const result = await response.json();
                if (!response.ok || !result.success || !Array.isArray(result.data)) throw new Error('Products unavailable');
                if (!result.data.length) {
                    homeProducts.innerHTML = '<p class="home-products-state">لا توجد منتجات متاحة حاليًا. <a href="products.html">تصفح جميع المنتجات</a></p>';
                    return;
                }

                homeProducts.replaceChildren(...result.data.slice(0, 4).map((product) => {
                    const detailUrl = `product.html?slug=${encodeURIComponent(product.slug || product._id)}`;
                    const originalPrice = Number(product.price) || 0;
                    const salePrice = Number(product.salePrice);
                    const price = salePrice > 0 && salePrice < originalPrice ? salePrice : originalPrice;
                    const discounted = price < originalPrice;
                    const card = document.createElement('article');
                    card.className = 'home-product-card';

                    const imageLink = document.createElement('a');
                    imageLink.className = 'home-product-image';
                    imageLink.href = detailUrl;
                    imageLink.setAttribute('aria-label', `عرض ${product.name || 'المنتج'}`);
                    const image = document.createElement('img');
                    image.src = product.image || 'assets/logo.jpg';
                    image.alt = product.name || '';
                    image.loading = 'lazy';
                    image.onerror = () => { image.src = 'assets/logo.jpg'; };
                    imageLink.append(image);
                    if (showPrices && discounted) {
                        const badge = document.createElement('span');
                        badge.className = 'home-product-discount customer-discount';
                        badge.textContent = `خصم ${Math.round((1 - price / originalPrice) * 100)}%`;
                        imageLink.append(badge);
                    }

                    const info = document.createElement('div');
                    info.className = 'home-product-info';
                    const brand = document.createElement('p');
                    brand.className = 'home-product-brand';
                    brand.textContent = product.brand || product.categoryName || 'منتج مميز';
                    const title = document.createElement('h3');
                    const titleLink = document.createElement('a');
                    titleLink.href = detailUrl;
                    titleLink.textContent = product.name || 'منتج';
                    title.append(titleLink);
                    const bottom = document.createElement('div');
                    bottom.className = 'home-product-bottom';
                    const priceLabel = document.createElement('p');
                    priceLabel.className = 'home-product-price customer-price';
                    priceLabel.textContent = `${price.toLocaleString('en-EG')} ج.م`;
                    if (discounted) {
                        const oldPrice = document.createElement('del');
                        oldPrice.textContent = originalPrice.toLocaleString('en-EG');
                        priceLabel.append(oldPrice);
                    }
                    const detailsLink = document.createElement('a');
                    detailsLink.className = 'home-product-open';
                    detailsLink.href = detailUrl;
                    detailsLink.setAttribute('aria-label', `تفاصيل ${product.name || 'المنتج'}`);
                    detailsLink.innerHTML = '<i class="fa-solid fa-arrow-left" aria-hidden="true"></i>';
                    bottom.append(priceLabel, detailsLink);
                    info.append(brand, title, bottom);
                    card.append(imageLink, info);
                    return card;
                }));
            } catch {
                homeProducts.innerHTML = '<p class="home-products-state">تعذر تحميل المنتجات الآن. <a href="products.html">تصفح جميع المنتجات</a></p>';
            } finally {
                window.clearTimeout(timeout);
            }
        };
        loadHomeProducts();
    }

    // Mobile Menu Toggle
    const menuToggle = document.querySelector('.menu-toggle');
    const navLinks = document.querySelector('.nav-links');

    const closeNavigation = (restoreFocus = false) => {
        const wasOpen = navLinks?.classList.contains('active');
        navLinks?.classList.remove('active');
        menuToggle?.setAttribute('aria-expanded', 'false');
        if (menuToggle) menuToggle.setAttribute('aria-label', 'فتح القائمة');
        if (restoreFocus && wasOpen) menuToggle?.focus();
    };

    if (menuToggle && navLinks) {
        menuToggle.addEventListener('click', () => {
            const open = menuToggle.getAttribute('aria-expanded') !== 'true';
            navLinks.classList.toggle('active', open);
            menuToggle.setAttribute('aria-expanded', String(open));
            menuToggle.setAttribute('aria-label', open ? 'إغلاق القائمة' : 'فتح القائمة');
            if (open) navLinks.querySelector('a')?.focus();
        });

        navLinks.querySelectorAll('a').forEach((link) => {
            link.addEventListener('click', () => closeNavigation(true));
        });

        document.addEventListener('click', (event) => {
            if (!event.target.closest('.navbar')) closeNavigation();
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && navLinks.classList.contains('active')) {
                closeNavigation(true);
            }
        });
    }

    // Keep the featured-products dropdown usable even if the homepage-only
    // product showcase script is unavailable or still cached by the browser.
    const featuredToggle = document.querySelector('.nav-featured-products-toggle');
    const featuredMenu = document.getElementById('nav-featured-products-menu');
    const featuredList = document.getElementById('nav-featured-products-list');
    if (featuredToggle && featuredMenu && featuredList) {
        const closeFeaturedMenu = () => {
            featuredMenu.hidden = true;
            featuredToggle.setAttribute('aria-expanded', 'false');
        };

        featuredToggle.addEventListener('click', async (event) => {
            event.stopPropagation();
            const open = featuredToggle.getAttribute('aria-expanded') !== 'true';
            featuredToggle.setAttribute('aria-expanded', String(open));
            featuredMenu.hidden = !open;
            if (!open || featuredList.dataset.loaded === 'true' || featuredList.dataset.loading === 'true') return;

            featuredList.dataset.loading = 'true';
            const apiBase = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
                ? (window.location.port === '5000' ? '/api' : 'http://localhost:5000/api')
                : '/api';
            try {
                const response = await fetch(`${apiBase}/products/featured?limit=3`);
                const result = await response.json();
                if (!response.ok || !result.success || !Array.isArray(result.data) || !result.data.length) {
                    throw new Error('No featured products');
                }
                featuredList.replaceChildren(...result.data.slice(0, 3).map((product) => {
                    const link = document.createElement('a');
                    link.className = 'nav-featured-product';
                    link.href = `product.html?slug=${encodeURIComponent(product.slug || product._id)}`;
                    const image = document.createElement('img');
                    image.src = product.image || 'assets/logo.jpg';
                    image.alt = '';
                    image.loading = 'lazy';
                    image.onerror = () => { image.src = 'assets/logo.jpg'; };
                    const details = document.createElement('span');
                    const name = document.createElement('strong');
                    name.textContent = product.name || 'منتج';
                    const price = document.createElement('small');
                    price.className = 'customer-price';
                    price.textContent = `${Number(product.salePrice || product.price || 0).toLocaleString('en-EG')} ج.م`;
                    details.append(name, price);
                    link.append(image, details);
                    return link;
                }));
                featuredList.dataset.loaded = 'true';
            } catch {
                featuredList.textContent = 'تعذر تحميل الاختيارات الآن. حاول مرة أخرى.';
                featuredList.dataset.loaded = 'false';
            } finally {
                delete featuredList.dataset.loading;
            }
        });

        document.addEventListener('click', (event) => {
            if (!event.target.closest('.nav-featured-products-item')) closeFeaturedMenu();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closeFeaturedMenu();
        });
        featuredList.addEventListener('click', (event) => {
            if (event.target.closest('a')) closeFeaturedMenu();
        });
    }

    // Smooth Scrolling for anchor links (safely handles target lookup)
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            if (!href || href === '#') return;
            try {
                const target = document.querySelector(href);
                if (target) {
                    e.preventDefault();
                    closeNavigation();
                    target.scrollIntoView({
                        behavior: 'smooth'
                    });
                }
            } catch (err) {
                // Ignore invalid selectors
            }
        });
    });

    // Public Contact Form Submission
    const contactForm = document.getElementById('public-contact-form');
    if (contactForm) {
        contactForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('contact-name').value;
            const phone = document.getElementById('contact-phone').value;
            const message = document.getElementById('contact-msg').value;
            const feedback = document.getElementById('contact-feedback');
            const submitButton = contactForm.querySelector('[type="submit"]');
            if (submitButton?.disabled) return;
            if (submitButton) submitButton.disabled = true;

            feedback.style.display = 'block';
            feedback.style.color = 'var(--primary-color)';
            feedback.textContent = 'جاري إرسال الرسالة...';

            const API_BASE = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
                ? (window.location.port === '5000' ? '/api' : 'http://localhost:5000/api')
                : '/api';

            try {
                const res = await fetch(`${API_BASE}/contacts`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, phone, message })
                });
                const json = await res.json();
                if (json.success) {
                    feedback.style.color = '#25D366';
                    feedback.textContent = 'تم إرسال رسالتك بنجاح! سيتم التواصل معك قريباً.';
                    contactForm.reset();
                } else {
                    throw new Error(json.message || 'فشل الإرسال');
                }
            } catch (err) {
                // Offer a user-initiated WhatsApp link; delayed popups are
                // blocked by mobile browsers after the async request fails.
                feedback.style.color = '#25D366';
                const waText = `مرحباً م/ محمد،\nأنا: ${name}\nرقمي: ${phone}\nالاستفسار: ${message}`;
                const link = document.createElement('a');
                link.href = `https://wa.me/201093044150?text=${encodeURIComponent(waText)}`;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = 'تعذر الإرسال من الموقع. أرسل رسالتك عبر واتساب';
                feedback.replaceChildren(link);
            } finally {
                if (submitButton) submitButton.disabled = false;
            }
        });
    }
});
