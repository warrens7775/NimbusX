const menuToggle = document.getElementById("menuToggle");
const siteNav = document.getElementById("siteNav");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const siteHeader = document.querySelector(".site-header");
const backToTop = document.querySelector(".back-to-top");
const parallaxTargets = document.querySelectorAll(".hero-content, .hero-panel, .three-copy, .page-hero .container");
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
    "a, button, input, select, textarea, .card, .price-card, .resource-card, .hero-panel, .flow-steps article, .media-stage, .depth-card, .visual-glass, .auth-card, .dash-sidebar, .empty-state, .projects-table, .project-modal, .admin-card, .admin-table-wrap, .group-rail, .selected-group-panel"
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
    ".three-copy",
    ".model-stat",
    ".experience-copy",
    ".media-stage",
    ".image-panel",
    ".depth-card",
    ".visual-glass",
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

const modelCanvas = document.getElementById("cloudModelCanvas");

if (modelCanvas && window.THREE) {
  const THREE = window.THREE;
  const section = modelCanvas.closest(".three-cloud");
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  const renderer = new THREE.WebGLRenderer({
    canvas: modelCanvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  const root = new THREE.Group();
  const packetPaths = [];
  const pointer = { x: 0, y: 0 };
  const accentTeal = new THREE.Color("#0891b2");
  const accentCyan = new THREE.Color("#67e8f9");
  const accentAmber = new THREE.Color("#f59e0b");

  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  scene.add(root);

  camera.position.set(0, 5.8, 12);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xbdf8ff, 1.45));

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(-4, 8, 6);
  scene.add(keyLight);

  const tealLight = new THREE.PointLight(0x67e8f9, 8.5, 22);
  tealLight.position.set(4.8, 3, 4.8);
  scene.add(tealLight);

  const amberLight = new THREE.PointLight(0xf59e0b, 6.2, 18);
  amberLight.position.set(-4.2, 2.8, -3.4);
  scene.add(amberLight);

  const darkMaterial = new THREE.MeshStandardMaterial({
    color: 0x18181b,
    roughness: 0.42,
    metalness: 0.72,
  });
  const tealMaterial = new THREE.MeshStandardMaterial({
    color: 0x0891b2,
    roughness: 0.28,
    metalness: 0.5,
    emissive: 0x034452,
    emissiveIntensity: 1.05,
  });
  const cyanMaterial = new THREE.MeshStandardMaterial({
    color: 0x67e8f9,
    roughness: 0.2,
    metalness: 0.35,
    emissive: 0x0e7490,
    emissiveIntensity: 1.35,
  });
  const amberMaterial = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    roughness: 0.28,
    metalness: 0.35,
    emissive: 0x7c2d12,
    emissiveIntensity: 1.1,
  });

  const platform = new THREE.Mesh(new THREE.BoxGeometry(8.8, 0.24, 5.4), darkMaterial);
  platform.position.y = -0.28;
  platform.rotation.y = -0.04;
  root.add(platform);

  const grid = new THREE.GridHelper(12, 24, 0x67e8f9, 0x27272a);
  grid.position.y = -0.13;
  grid.material.transparent = true;
  grid.material.opacity = 0.34;
  root.add(grid);

  const addServer = (x, z, height, material = tealMaterial) => {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.48, height, 0.56), material);
    body.position.y = height / 2;
    group.add(body);

    for (let i = 0; i < 3; i += 1) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.035, 0.59), cyanMaterial);
      stripe.position.set(0, 0.28 + i * 0.34, 0.01);
      group.add(stripe);
    }

    group.position.set(x, -0.16, z);
    root.add(group);
    return group;
  };

  const addStorage = (x, z) => {
    const group = new THREE.Group();
    for (let i = 0; i < 4; i += 1) {
      const disk = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.16, 40), i % 2 ? cyanMaterial : darkMaterial);
      disk.position.y = i * 0.2;
      group.add(disk);
    }
    group.position.set(x, 0.02, z);
    root.add(group);
    return group;
  };

  const addNode = (x, z, material, scale = 1) => {
    const node = new THREE.Mesh(new THREE.SphereGeometry(0.18 * scale, 24, 16), material);
    node.position.set(x, 0.18, z);
    root.add(node);
    return node;
  };

  const servers = [
    addServer(-2.9, -1.4, 1.35),
    addServer(-2.25, -1.4, 1.65, cyanMaterial),
    addServer(-1.6, -1.4, 1.18),
    addServer(2.45, -1.38, 1.25),
    addServer(3.1, -1.38, 1.48, cyanMaterial),
    addServer(2.82, 1.15, 1.15),
  ];

  const storage = [addStorage(-0.35, 1.32), addStorage(0.52, 1.12), addStorage(1.34, 0.92)];
  const nodes = [
    addNode(-3.5, 1.55, amberMaterial, 1.15),
    addNode(-0.2, -1.76, cyanMaterial, 1.08),
    addNode(3.72, 1.42, amberMaterial, 1.15),
    addNode(0.2, 0.02, tealMaterial, 1.35),
  ];

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.05, 0.035, 12, 96),
    new THREE.MeshStandardMaterial({
      color: 0x67e8f9,
      emissive: 0x0891b2,
      emissiveIntensity: 1.2,
      metalness: 0.2,
      roughness: 0.18,
    })
  );
  ring.position.set(0.18, 0.52, 0.04);
  ring.rotation.x = Math.PI / 2;
  root.add(ring);

  const makePath = (points, color) => {
    const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(point[0], point[1], point[2])));
    const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(72));
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.68 });
    const line = new THREE.Line(geometry, material);
    const packet = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 12), color === 0xf59e0b ? amberMaterial : cyanMaterial);
    root.add(line, packet);
    packetPaths.push({ curve, packet, speed: 0.08 + Math.random() * 0.05, offset: Math.random() });
  };

  makePath([[-3.5, 0.3, 1.55], [-1.2, 0.34, 0.2], [0.2, 0.42, 0.02], [3.72, 0.3, 1.42]], 0x67e8f9);
  makePath([[-2.6, 0.3, -1.42], [-0.8, 0.42, -0.7], [0.2, 0.48, 0.02], [2.8, 0.3, -1.38]], 0xf59e0b);
  makePath([[-0.35, 0.3, 1.32], [0.2, 0.52, 0.02], [2.82, 0.34, 1.15]], 0x67e8f9);

  root.rotation.x = -0.18;
  root.rotation.y = -0.32;
  root.position.set(2.25, 0.08, -0.2);

  const resizeModel = () => {
    const rect = section.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.position.z = width < 720 ? 15.5 : 12;
    root.position.x = width < 720 ? 0.25 : 2.25;
    root.position.y = width < 720 ? -1.05 : 0.08;
    root.scale.setScalar(width < 720 ? 0.82 : 1);
    camera.updateProjectionMatrix();
  };

  window.addEventListener("resize", resizeModel);
  section.addEventListener(
    "pointermove",
    (event) => {
      const rect = section.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      pointer.y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    },
    { passive: true }
  );

  const clock = new THREE.Clock();
  let modelFrame = 0;

  const renderModel = () => {
    const elapsed = clock.getElapsedTime();
    modelFrame += 1;

    root.rotation.y += ((-0.32 + pointer.x * 0.16) - root.rotation.y) * 0.035;
    root.rotation.x += ((-0.18 - pointer.y * 0.06) - root.rotation.x) * 0.035;
    ring.rotation.z = elapsed * 0.8;

    servers.forEach((server, index) => {
      server.position.y = -0.16 + Math.sin(elapsed * 1.3 + index * 0.7) * 0.035;
    });

    storage.forEach((item, index) => {
      item.rotation.y = elapsed * (0.35 + index * 0.08);
    });

    nodes.forEach((node, index) => {
      const pulse = 1 + Math.sin(elapsed * 2.2 + index) * 0.12;
      node.scale.setScalar(pulse);
    });

    packetPaths.forEach((path) => {
      const t = (elapsed * path.speed + path.offset) % 1;
      path.packet.position.copy(path.curve.getPointAt(t));
    });

    renderer.render(scene, camera);

    if (!reduceMotion || modelFrame < 3) {
      window.requestAnimationFrame(renderModel);
    }
  };

  resizeModel();
  renderModel();
}

if (!reduceMotion && window.matchMedia("(pointer: fine)").matches) {
  document.querySelectorAll("[data-tilt], [data-depth-card], .card, .price-card, .resource-card, .image-panel").forEach((element) => {
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
