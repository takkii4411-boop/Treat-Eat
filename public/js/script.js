async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function checkAuth() {
  const data = await api('/api/auth/me');
  return data.user;
}

function updateNav(user) {
  const navLinks = document.querySelector('.nav-links');
  if (!navLinks) return;

  const existingAuth = document.querySelector('.nav-auth');
  if (existingAuth) existingAuth.remove();

  const authLi = document.createElement('li');
  authLi.className = 'nav-auth';
  authLi.style.display = 'flex';
  authLi.style.gap = '1.2rem';
  authLi.style.alignItems = 'center';

  if (user) {
    const cartLink = document.createElement('a');
    cartLink.href = '/cart.html';
    cartLink.textContent = '🛒 Cart';
    cartLink.style.position = 'relative';
    cartLink.id = 'cart-nav-link';

    const badge = document.createElement('span');
    badge.id = 'cart-badge';
    badge.style.cssText = 'position:absolute;top:-8px;right:-12px;background:var(--rose);color:#fff;font-size:.55rem;padding:2px 6px;border-radius:999px;display:none';
    badge.textContent = '0';
    cartLink.appendChild(badge);

    const ordersLink = document.createElement('a');
    ordersLink.href = '/orders.html';
    ordersLink.textContent = 'My Orders';

    const greet = document.createElement('span');
    greet.style.cssText = 'font-size:.75rem;color:var(--muted)';
    greet.textContent = `Hi, ${user.name.split(' ')[0]}`;

    const logoutBtn = document.createElement('a');
    logoutBtn.href = '#';
    logoutBtn.textContent = 'Logout';
    logoutBtn.onclick = async (e) => {
      e.preventDefault();
      await api('/api/auth/logout', { method: 'POST' });
      window.location.reload();
    };

    if (user.isAdmin) {
      const adminLink = document.createElement('a');
      adminLink.href = '/admin.html';
      adminLink.textContent = 'Admin';
      authLi.appendChild(adminLink);
    }

    authLi.appendChild(cartLink);
    authLi.appendChild(ordersLink);
    authLi.appendChild(greet);
    authLi.appendChild(logoutBtn);
  } else {
    const loginLink = document.createElement('a');
    loginLink.href = '/login.html';
    loginLink.textContent = 'Login';

    const registerLink = document.createElement('a');
    registerLink.href = '/register.html';
    registerLink.textContent = 'Register';

    authLi.appendChild(loginLink);
    authLi.appendChild(registerLink);
  }

  // Toast container
  if (!document.getElementById('toast-container')) {
    const tc = document.createElement('div');
    tc.id = 'toast-container';
    tc.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px';
    document.body.appendChild(tc);
  }

  navLinks.appendChild(authLi);
  updateCartBadge();
}

async function updateCartBadge() {
  const badge = document.getElementById('cart-badge');
  const iconBadge = document.getElementById('cart-badge-icon');
  try {
    const data = await api('/api/cart');
    const count = data.items ? data.items.reduce((s, i) => s + i.quantity, 0) : 0;
    if (badge) { badge.textContent = count; badge.style.display = count > 0 ? 'inline' : 'none'; }
    if (iconBadge) { iconBadge.textContent = count; iconBadge.style.display = count > 0 ? 'inline' : 'none'; }
  } catch {
    if (badge) badge.style.display = 'none';
    if (iconBadge) iconBadge.style.display = 'none';
  }
}

function showToast(msg, type) {
  const tc = document.getElementById('toast-container');
  if (!tc) return;
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'padding:10px 18px;border-radius:10px;font-size:.85rem;color:#fff;animation:slideIn .3s ease;box-shadow:0 4px 20px rgba(0,0,0,0.2);max-width:320px;' + (type === 'error' ? 'background:#c62828;' : 'background:#2e7d32;');
  tc.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 2000);
}

async function addToCart(productId, productName, productPrice, productImage) {
  const user = await checkAuth();
  if (!user) {
    window.location.href = '/login.html?redirect=' + encodeURIComponent(window.location.pathname);
    return;
  }
  try {
    await api('/api/cart/add', {
      method: 'POST',
      body: JSON.stringify({
        product_id: productId,
        product_name: productName,
        product_price: productPrice,
        product_image: productImage
      })
    });
    updateCartBadge();
    showToast('Added to cart');
  } catch (e) {
    showToast(e.message || 'Failed to add to cart', 'error');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await checkAuth();
  updateNav(user);

  document.querySelectorAll('.add-to-cart-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      const id = this.dataset.productId;
      const name = this.dataset.productName;
      const price = parseFloat(this.dataset.productPrice);
      const image = this.dataset.productImage || '';
      addToCart(id, name, price, image);
    });
  });

  const hamburger = document.querySelector('.hamburger');
  const navLinks = document.querySelector('.nav-links');
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('active');
      navLinks.classList.toggle('active');
    });
    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('active');
        navLinks.classList.remove('active');
      });
    });
  }
});
