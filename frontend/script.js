document.addEventListener('DOMContentLoaded', () => {
    // Mobile Menu Toggle
    const menuToggle = document.querySelector('.menu-toggle');
    const navLinks = document.querySelector('.nav-links');

    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            navLinks.classList.toggle('active');
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
                    if (navLinks) navLinks.classList.remove('active');
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
                // WhatsApp fallback
                feedback.style.color = '#25D366';
                feedback.textContent = 'جاري توجيهك إلى واتساب لإرسال الرسالة مباشرة...';
                const waText = `مرحباً م/ محمد،\nأنا: ${name}\nرقمي: ${phone}\nالاستفسار: ${message}`;
                setTimeout(() => {
                    window.open(`https://wa.me/201093044150?text=${encodeURIComponent(waText)}`, '_blank');
                }, 1000);
            }
        });
    }
});
