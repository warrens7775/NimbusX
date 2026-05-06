const menuToggle = document.getElementById("menuToggle");
const siteNav = document.getElementById("siteNav");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const siteHeader = document.querySelector(".site-header");
const backToTop = document.querySelector(".back-to-top");
const parallaxTargets = document.querySelectorAll(".hero-content, .ui-console, .page-hero .container");
const canUseCursorEffect =
  !reduceMotion && window.matchMedia("(pointer: fine)").matches && !window.matchMedia("(hover: none)").matches;
let scrollTicking = false;

if (canUseCursorEffect) {
  const spotlight = document.createElement("div");
  const cursorRing = document.createElement("div");
  const cursorDot = document.createElement("div");
  let cursorX = window.innerWidth / 2;
  let cursorY = window.innerHeight / 2;
  let ringX = cursorX;
  let ringY = cursorY;
  let cursorFrame = null;

  spotlight.className = "cursor-spotlight";
  cursorRing.className = "cursor-ring";
  cursorDot.className = "cursor-dot";
  document.body.append(spotlight, cursorRing, cursorDot);

  const drawCursor = () => {
    ringX += (cursorX - ringX) * 0.18;
    ringY += (cursorY - ringY) * 0.18;

    document.documentElement.style.setProperty("--cursor-x", `${cursorX}px`);
    document.documentElement.style.setProperty("--cursor-y", `${cursorY}px`);
    cursorDot.style.transform = `translate3d(${cursorX}px, ${cursorY}px, 0) translate(-50%, -50%)`;
    cursorRing.style.transform = `translate3d(${ringX}px, ${ringY}px, 0) translate(-50%, -50%)`;

    cursorFrame = window.requestAnimationFrame(drawCursor);
  };

  window.addEventListener(
    "pointermove",
    (event) => {
      cursorX = event.clientX;
      cursorY = event.clientY;
      document.body.classList.add("cursor-active");
      spotlight.classList.add("is-active");
      if (!cursorFrame) {
        drawCursor();
      }
    },
    { passive: true }
  );

  window.addEventListener("pointerleave", () => {
    document.body.classList.remove("cursor-active", "cursor-hover");
    spotlight.classList.remove("is-active");
  });

  document.querySelectorAll(
    "a, button, input, select, textarea, .card, .price-card, .resource-card, .hero-panel, .flow-steps article, .auth-card, .dash-sidebar, .empty-state, .projects-table, .project-modal"
  ).forEach((element) => {
    element.addEventListener("pointerenter", () => document.body.classList.add("cursor-hover"));
    element.addEventListener("pointerleave", () => document.body.classList.remove("cursor-hover"));
  });
}

const updateScrollUi = () => {
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  const progress = maxScroll > 0 ? window.scrollY / maxScroll : 0;

  document.documentElement.style.setProperty("--scroll-progress", String(progress));

  if (siteHeader) {
    siteHeader.classList.toggle("is-scrolled", window.scrollY > 24);
  }

  if (backToTop) {
    backToTop.classList.toggle("is-visible", window.scrollY > window.innerHeight * 0.55);
  }

  if (!reduceMotion) {
    const parallax = Math.min(window.scrollY * 0.055, 42);
    parallaxTargets.forEach((target, index) => {
      const direction = index % 2 === 0 ? 1 : -1;
      target.style.setProperty("--parallax-y", `${parallax * direction}px`);
    });
  }

  scrollTicking = false;
};

const requestScrollUpdate = () => {
  if (!scrollTicking) {
    window.requestAnimationFrame(updateScrollUi);
    scrollTicking = true;
  }
};

window.addEventListener("scroll", requestScrollUpdate, { passive: true });
window.addEventListener("resize", requestScrollUpdate);
updateScrollUi();

if (backToTop) {
  backToTop.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  });
}

if (!reduceMotion) {
  const canvas = document.createElement("canvas");
  canvas.className = "nx-canvas";
  canvas.setAttribute("aria-hidden", "true");
  document.body.prepend(canvas);

  const ctx = canvas.getContext("2d");
  const points = [];
  const pointCount = 42;

  const resizeCanvas = () => {
    canvas.width = window.innerWidth * window.devicePixelRatio;
    canvas.height = window.innerHeight * window.devicePixelRatio;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  };

  const seedPoints = () => {
    points.length = 0;
    for (let i = 0; i < pointCount; i += 1) {
      points.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: (Math.random() - 0.5) * 0.32,
        vy: (Math.random() - 0.5) * 0.32,
        r: Math.random() * 1.6 + 0.8,
      });
    }
  };

  const drawNetwork = () => {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.fillStyle = "rgba(23, 105, 224, 0.16)";
    ctx.strokeStyle = "rgba(23, 105, 224, 0.08)";

    points.forEach((point, index) => {
      point.x += point.vx;
      point.y += point.vy;

      if (point.x < -20 || point.x > window.innerWidth + 20) point.vx *= -1;
      if (point.y < -20 || point.y > window.innerHeight + 20) point.vy *= -1;

      ctx.beginPath();
      ctx.arc(point.x, point.y, point.r, 0, Math.PI * 2);
      ctx.fill();

      for (let j = index + 1; j < points.length; j += 1) {
        const other = points[j];
        const distance = Math.hypot(point.x - other.x, point.y - other.y);
        if (distance < 150) {
          ctx.globalAlpha = 1 - distance / 150;
          ctx.beginPath();
          ctx.moveTo(point.x, point.y);
          ctx.lineTo(other.x, other.y);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    });

    window.requestAnimationFrame(drawNetwork);
  };

  resizeCanvas();
  seedPoints();
  drawNetwork();
  window.addEventListener("resize", () => {
    resizeCanvas();
    seedPoints();
  });
}

if (menuToggle && siteNav) {
  menuToggle.addEventListener("click", () => {
    const open = siteNav.classList.toggle("open");
    menuToggle.setAttribute("aria-expanded", String(open));
  });

  siteNav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      siteNav.classList.remove("open");
      menuToggle.setAttribute("aria-expanded", "false");
    });
  });
}

const contactForm = document.querySelector(".contact-form");
if (contactForm) {
  contactForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = contactForm.querySelector("button");
    const status = contactForm.querySelector(".form-status");
    const formData = new FormData(contactForm);
    const payload = Object.fromEntries(formData.entries());

    if (button) {
      button.textContent = "Sending...";
      button.setAttribute("disabled", "true");
    }

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!result.ok) {
        throw new Error(result.message || "Request failed");
      }
      if (status) {
        status.textContent = "Thanks. NimbusX will contact you about your cloud requirements.";
      }
    } catch (error) {
      if (status) {
        status.textContent = "Request captured locally. Start app.py to save leads into the database.";
      }
    }

    if (button) {
      button.textContent = "Request Sent";
    }
  });
}

const calculator = document.querySelector(".calculator");

if (calculator) {
  const inputs = calculator.querySelectorAll("input, select");
  const total = calculator.querySelector("[data-total]");
  const breakdown = calculator.querySelector("[data-breakdown]");

  const currency = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

  const calculate = () => {
    const vcpu = Number(calculator.querySelector("#calcVcpu").value || 0);
    const memory = Number(calculator.querySelector("#calcMemory").value || 0);
    const storage = Number(calculator.querySelector("#calcStorage").value || 0);
    const bandwidth = Number(calculator.querySelector("#calcBandwidth").value || 0);
    const backups = Number(calculator.querySelector("#calcBackups").value || 0);
    const vpn = Number(calculator.querySelector("#calcVpn").value || 0);

    const computeCost = vcpu * 11 + memory * 4;
    const storageCost = storage * 0.02;
    const bandwidthCost = bandwidth * 0.035;
    const backupCost = backups * 0.012;
    const vpnCost = vpn * 35;
    const monthlyTotal = computeCost + storageCost + bandwidthCost + backupCost + vpnCost;

    if (total) {
      total.textContent = currency.format(monthlyTotal);
    }

    if (breakdown) {
      breakdown.innerHTML = `
        <span>Compute: ${currency.format(computeCost)}</span>
        <span>Storage: ${currency.format(storageCost)}</span>
        <span>Network: ${currency.format(bandwidthCost)}</span>
        <span>Backup/VPN: ${currency.format(backupCost + vpnCost)}</span>
      `;
    }
  };

  inputs.forEach((input) => input.addEventListener("input", calculate));
  calculate();
}

const revealTargets = document.querySelectorAll(
  [
    ".section-head",
    ".card",
    ".segment-card",
    ".why-card",
    ".resource-card",
    ".price-card",
    ".region-card",
    ".blog-card",
    ".calculator",
    ".comparison-table",
    ".security-detail-grid",
    ".faq-grid article",
    ".detail-list article",
    ".mini-metrics div",
    ".contact-form",
    ".auth-card",
    ".dash-sidebar",
    ".dash-topbar",
    ".vm-header",
    ".tabs",
    ".empty-state",
    ".vm-list-section",
    ".projects-header",
    ".projects-controls",
    ".projects-table",
  ].join(",")
);

if ("IntersectionObserver" in window) {
  revealTargets.forEach((element, index) => {
    element.classList.add("reveal");
    element.style.transitionDelay = `${Math.min(index % 6, 5) * 55}ms`;
  });

  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.14 }
  );

  revealTargets.forEach((element) => revealObserver.observe(element));
} else {
  revealTargets.forEach((element) => element.classList.add("is-visible"));
}

if (!reduceMotion && window.matchMedia("(pointer: fine)").matches) {
  document.querySelectorAll("[data-tilt], .card, .price-card, .resource-card").forEach((element) => {
    element.addEventListener("pointermove", (event) => {
      const rect = element.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      element.style.transform = `perspective(900px) rotateX(${y * -5}deg) rotateY(${x * 6}deg) translateY(-6px)`;
    });

    element.addEventListener("pointerleave", () => {
      element.style.transform = "";
    });
  });
}
