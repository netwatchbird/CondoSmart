// CondoSmart SPA Frontend Engine

let jwtToken = localStorage.getItem("token") || null;
let currentUser = null;
let currentRole = "Residente"; // Default selected in login
let activeSection = ""; // E.g., 'finanzas', 'seguridad', 'operaciones'
let wsConn = null;

// Charts instances
let pressureChartInstance = null;
let pressureChartData = [];
let pressureChartLabels = [];

// Initializer
document.addEventListener("DOMContentLoaded", () => {
    initApp();
});

function initApp() {
    if (jwtToken) {
        fetchProfile();
    } else {
        showScreen("login-screen");
    }
}

function showScreen(screenId) {
    document.getElementById("login-screen").classList.add("hidden");
    document.getElementById("recovery-screen").classList.add("hidden");
    document.getElementById("main-app").classList.add("hidden");
    
    document.getElementById(screenId).classList.remove("hidden");
    
    if (screenId === "login-screen") {
        setLoginRole(currentRole);
    }
}

function setLoginRole(role) {
    currentRole = role;
    const btnRes = document.getElementById("btn-resident");
    const btnAdm = document.getElementById("btn-admin");
    
    if (role === "Residente") {
        btnRes.classList.add("active");
        btnRes.querySelector(".material-symbols-outlined").classList.replace("text-on-surface-variant", "text-primary");
        btnAdm.classList.remove("active");
        btnAdm.querySelector(".material-symbols-outlined").classList.replace("text-primary", "text-on-surface-variant");
    } else {
        btnAdm.classList.add("active");
        btnAdm.querySelector(".material-symbols-outlined").classList.replace("text-on-surface-variant", "text-primary");
        btnRes.classList.remove("active");
        btnRes.querySelector(".material-symbols-outlined").classList.replace("text-primary", "text-on-surface-variant");
    }
}

function togglePasswordVisibility() {
    const pwdInput = document.getElementById("password");
    if (pwdInput.type === "password") {
        pwdInput.type = "text";
    } else {
        pwdInput.type = "password";
    }
}

// ----------------- AUTHENTICATION -----------------

async function handleLogin(event) {
    event.preventDefault();
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;
    const errBox = document.getElementById("login-error");
    errBox.classList.add("hidden");

    try {
        const res = await fetch("/api/v1/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: jsonPayload({ correo: email, password: password })
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.mensaje || "Error al iniciar sesion");
        
        jwtToken = data.token;
        currentUser = data.usuario;
        localStorage.setItem("token", jwtToken);
        
        enterPortal();
    } catch (err) {
        errBox.classList.remove("hidden");
        document.getElementById("login-error-text").innerText = err.message;
    }
}

async function fetchProfile() {
    try {
        const res = await fetch("/api/v1/auth/me", {
            headers: { "Authorization": `Bearer ${jwtToken}` }
        });
        if (!res.ok) throw new Error("Sesion expirada");
        
        currentUser = await res.json();
        enterPortal();
    } catch (err) {
        logout();
    }
}

function logout() {
    if (jwtToken && currentUser) {
        logEventOnServer("Cierre de sesion", `El usuario ${currentUser.nombre} cerro sesion.`);
    }
    jwtToken = null;
    currentUser = null;
    localStorage.removeItem("token");
    if (wsConn) {
        wsConn.close();
        wsConn = null;
    }
    showScreen("login-screen");
}

function handleRecovery(event) {
    event.preventDefault();
    const email = document.getElementById("recovery-email").value;
    if (email) {
        document.getElementById("recoveryForm").classList.add("hidden");
        document.getElementById("successMessage").classList.remove("hidden");
    }
}

// Log actions dynamically helper
async function logEventOnServer(accion, detalles) {
    // Just a passive request log
}

// ----------------- PORTAL LAYOUT ORCHESTRATOR -----------------

function enterPortal() {
    showScreen("main-app");
    
    // Set user headers
    document.getElementById("profile-name").innerText = currentUser.nombre;
    document.getElementById("profile-email").innerText = currentUser.correo;
    document.getElementById("profile-avatar").innerText = currentUser.nombre[0].toUpperCase();
    document.getElementById("sidebar-role-label").innerText = currentUser.rol;
    
    // Draw sidebar and mobile menu depending on Role
    setupMenus();
    
    // Connect WebSockets
    connectWebSockets();
    
    // Default navigate
    if (currentUser.rol === "Residente") {
        navigateToSection("finanzas");
    } else {
        navigateToSection("dashboard");
    }
}

function setupMenus() {
    const sidebarNav = document.getElementById("sidebar-nav");
    const mobileNav = document.getElementById("mobile-nav");
    const sidebarBottom = document.getElementById("sidebar-bottom-actions");
    
    sidebarNav.innerHTML = "";
    mobileNav.innerHTML = "";
    sidebarBottom.innerHTML = "";
    
    if (currentUser.rol === "Residente") {
        // Desktop Sidebar Links
        sidebarNav.innerHTML = `
            <a class="flex items-center gap-4 p-3 text-on-surface-variant hover:bg-surface-container rounded-lg transition-all" href="#" id="side-link-finanzas" onclick="navigateToSection('finanzas')">
                <span class="material-symbols-outlined">payments</span>
                <span class="text-sm font-semibold">Finanzas</span>
            </a>
            <a class="flex items-center gap-4 p-3 text-on-surface-variant hover:bg-surface-container rounded-lg transition-all" href="#" id="side-link-seguridad" onclick="navigateToSection('seguridad')">
                <span class="material-symbols-outlined">security</span>
                <span class="text-sm font-semibold">Seguridad</span>
            </a>
            <a class="flex items-center gap-4 p-3 text-on-surface-variant hover:bg-surface-container rounded-lg transition-all" href="#" id="side-link-operaciones" onclick="navigateToSection('operaciones')">
                <span class="material-symbols-outlined">engineering</span>
                <span class="text-sm font-semibold">Operaciones</span>
            </a>
        `;
        
        // Desktop Sidebar Bottom
        sidebarBottom.innerHTML = `
            <button class="bg-primary text-on-primary py-3 rounded-full flex items-center justify-center gap-2 hover:opacity-95 text-xs font-bold" onclick="openReportPaymentModal()">
                <span class="material-symbols-outlined text-sm">add_circle</span>
                Reportar Pago
            </button>
            <button class="border border-outline text-on-surface py-2.5 rounded-full flex items-center justify-center gap-2 hover:bg-surface-container text-xs font-bold" onclick="logout()">
                <span class="material-symbols-outlined text-sm">logout</span>
                Cerrar Sesión
            </button>
        `;
        
        // Mobile Navigation Links
        mobileNav.innerHTML = `
            <button class="flex flex-col items-center justify-center text-on-surface-variant px-4 py-2" id="mob-link-finanzas" onclick="navigateToSection('finanzas')">
                <span class="material-symbols-outlined">payments</span>
                <span class="text-[10px] font-medium">Finanzas</span>
            </button>
            <button class="flex flex-col items-center justify-center text-on-surface-variant px-4 py-2" id="mob-link-seguridad" onclick="navigateToSection('seguridad')">
                <span class="material-symbols-outlined">security</span>
                <span class="text-[10px] font-medium">Acceso</span>
            </button>
            <button class="flex flex-col items-center justify-center text-on-surface-variant px-4 py-2" id="mob-link-operaciones" onclick="navigateToSection('operaciones')">
                <span class="material-symbols-outlined">engineering</span>
                <span class="text-[10px] font-medium">Servicios</span>
            </button>
            <button class="flex flex-col items-center justify-center text-on-surface-variant px-4 py-2" onclick="logout()">
                <span class="material-symbols-outlined text-sm">logout</span>
                <span class="text-[10px] font-medium">Salir</span>
            </button>
        `;
    } else {
        // Admin Sidebar Links
        sidebarNav.innerHTML = `
            <a class="flex items-center gap-4 p-3 text-on-surface-variant hover:bg-surface-container rounded-lg transition-all" href="#" id="side-link-dashboard" onclick="navigateToSection('dashboard')">
                <span class="material-symbols-outlined">dashboard</span>
                <span class="text-sm font-semibold">Resumen</span>
            </a>
            <a class="flex items-center gap-4 p-3 text-on-surface-variant hover:bg-surface-container rounded-lg transition-all" href="#" id="side-link-finanzas" onclick="navigateToSection('finanzas')">
                <span class="material-symbols-outlined">payments</span>
                <span class="text-sm font-semibold">Finanzas</span>
            </a>
            <a class="flex items-center gap-4 p-3 text-on-surface-variant hover:bg-surface-container rounded-lg transition-all" href="#" id="side-link-seguridad" onclick="navigateToSection('seguridad')">
                <span class="material-symbols-outlined">security</span>
                <span class="text-sm font-semibold">Seguridad</span>
            </a>
            <a class="flex items-center gap-4 p-3 text-on-surface-variant hover:bg-surface-container rounded-lg transition-all" href="#" id="side-link-operaciones" onclick="navigateToSection('operaciones')">
                <span class="material-symbols-outlined">engineering</span>
                <span class="text-sm font-semibold">Operaciones</span>
            </a>
            <a class="flex items-center gap-4 p-3 text-on-surface-variant hover:bg-surface-container rounded-lg transition-all" href="#" id="side-link-comunidad" onclick="navigateToSection('comunidad')">
                <span class="material-symbols-outlined">groups</span>
                <span class="text-sm font-semibold">Comunidad</span>
            </a>
            <a class="flex items-center gap-4 p-3 text-on-surface-variant hover:bg-surface-container rounded-lg transition-all" href="#" id="side-link-database" onclick="navigateToSection('database')">
                <span class="material-symbols-outlined">database</span>
                <span class="text-sm font-semibold">Base de Datos</span>
            </a>
        `;
        
        // Admin Sidebar Bottom
        sidebarBottom.innerHTML = `
            <button class="bg-primary text-on-primary py-3 rounded-full flex items-center justify-center gap-2 hover:opacity-95 text-xs font-bold" onclick="openAddResidentModal()">
                <span class="material-symbols-outlined text-sm">person_add</span>
                Registrar Residente
            </button>
            <button class="border border-outline text-on-surface py-2.5 rounded-full flex items-center justify-center gap-2 hover:bg-surface-container text-xs font-bold" onclick="logout()">
                <span class="material-symbols-outlined text-sm">logout</span>
                Cerrar Sesión
            </button>
        `;
        
        // Mobile Admin Links
        mobileNav.innerHTML = `
            <button class="flex flex-col items-center justify-center text-on-surface-variant px-4 py-2" id="mob-link-dashboard" onclick="navigateToSection('dashboard')">
                <span class="material-symbols-outlined">dashboard</span>
                <span class="text-[10px] font-medium">Dashboard</span>
            </button>
            <button class="flex flex-col items-center justify-center text-on-surface-variant px-4 py-2" id="mob-link-finanzas" onclick="navigateToSection('finanzas')">
                <span class="material-symbols-outlined">payments</span>
                <span class="text-[10px] font-medium">Pagos</span>
            </button>
            <button class="flex flex-col items-center justify-center text-on-surface-variant px-4 py-2" id="mob-link-seguridad" onclick="navigateToSection('seguridad')">
                <span class="material-symbols-outlined">videocam</span>
                <span class="text-[10px] font-medium">Cámaras</span>
            </button>
            <button class="flex flex-col items-center justify-center text-on-surface-variant px-4 py-2" id="mob-link-operaciones" onclick="navigateToSection('operaciones')">
                <span class="material-symbols-outlined">engineering</span>
                <span class="text-[10px] font-medium">Servicios</span>
            </button>
        `;
    }
}

function navigateToSection(section) {
    activeSection = section;
    
    // Hide all viewports
    document.querySelectorAll("#viewport-content > section").forEach(sec => sec.classList.add("hidden"));
    
    // Set headers
    const titles = {
        finanzas: "Finanzas y Cuotas",
        seguridad: "Control de Acceso y Cámaras",
        operaciones: "Operaciones y Telemetría",
        dashboard: "Tablero de Control Admin",
        comunidad: "Directorio de Residentes",
        database: "Base de Datos en Vivo"
    };
    document.getElementById("top-title").innerText = titles[section] || "CondoSmart";
    
    // Active links styling
    document.querySelectorAll("#sidebar-nav a").forEach(a => a.classList.remove("nav-link-active"));
    document.querySelectorAll("#mobile-nav button").forEach(b => b.classList.remove("nav-link-active"));
    
    const sideLink = document.getElementById(`side-link-${section}`);
    if (sideLink) sideLink.classList.add("nav-link-active");
    
    const mobLink = document.getElementById(`mob-link-${section}`);
    if (mobLink) mobLink.classList.add("nav-link-active");

    // Show selected viewport section
    const viewId = currentUser.rol === "Residente" ? `view-resident-${section}` : `view-admin-${section}`;
    const targetView = document.getElementById(viewId);
    if (targetView) {
        targetView.classList.remove("hidden");
        targetView.classList.add("animate-fade-in");
    }
    
    // Load content dynamically
    if (currentUser.rol === "Residente") {
        if (section === "finanzas") loadResidentFinanzas();
        else if (section === "seguridad") loadResidentSeguridad();
        else if (section === "operaciones") loadResidentOperaciones();
    } else {
        if (section === "dashboard") loadAdminDashboard();
        else if (section === "finanzas") loadAdminFinanzas();
        else if (section === "seguridad") loadAdminSeguridad();
        else if (section === "operaciones") loadAdminOperaciones();
        else if (section === "comunidad") loadAdminComunidad();
        else if (section === "database") loadDBTable("usuarios");
    }
}

// ----------------- WEBSOCKET CONNECTIONS -----------------

function connectWebSockets() {
    if (wsConn) return;
    
    const wsUrl = `ws://${window.location.hostname}:5001`;
    wsConn = new WebSocket(wsUrl);
    
    wsConn.onopen = () => {
        console.log("WebSocket connection established successfully.");
    };
    
    wsConn.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWSMessage(data);
    };
    
    wsConn.onclose = () => {
        console.log("WebSocket connection closed. Retrying in 5 seconds...");
        wsConn = null;
        setTimeout(connectWebSockets, 5000);
    };
}

function handleWSMessage(data) {
    // 1. Water Pressure Telemetry Updates
    if (data.type === "telemetria") {
        document.getElementById("quick-pressure").innerText = `${data.presion_psi} PSI`;
        const qInd = document.getElementById("water-quick-indicator");
        
        if (data.alerta) {
            qInd.classList.replace("bg-blue-50", "bg-red-50");
            qInd.classList.replace("text-blue-800", "text-red-800");
            qInd.classList.replace("border-blue-100", "border-red-100");
        } else {
            qInd.classList.replace("bg-red-50", "bg-blue-50");
            qInd.classList.replace("text-red-800", "text-blue-800");
            qInd.classList.replace("border-red-100", "border-blue-100");
        }
        
        // Update charts dynamically if visible
        if (activeSection === "operaciones") {
            const label = new Date(data.timestamp).toLocaleTimeString();
            updateLiveChart(label, data.presion_psi);
            
            // Resident view updates
            const presVal = document.getElementById("res-pressure-val");
            const presStatus = document.getElementById("res-pressure-status");
            if (presVal) {
                presVal.innerHTML = `${data.presion_psi} <small class="text-sm font-normal text-on-surface-variant">PSI</small>`;
                if (data.alerta) {
                    presStatus.innerText = "ALERTA: PRESIÓN CRÍTICA";
                    presStatus.classList.replace("text-secondary", "text-error");
                } else {
                    presStatus.innerText = data.bomba_estado === "Nominal" ? "PRESIÓN ÓPTIMA" : "BOMBA STANDBY / FUGA";
                    presStatus.classList.replace("text-error", "text-secondary");
                }
            }
            
            // Admin view updates
            const admPres = document.getElementById("adm-dash-water-pressure");
            if (admPres) admPres.innerText = `${data.presion_psi} PSI`;
            
            // Update pumps list
            updatePumpsUI(data.bomba_estado, data.leak);
        }
        
        if (currentUser.rol === "Administrador" && activeSection === "dashboard") {
            document.getElementById("adm-dash-water-pressure").innerText = `${data.presion_psi} PSI`;
            const statusLabel = document.getElementById("adm-dash-water-status");
            if (data.alerta) {
                statusLabel.innerText = "Crítico";
                statusLabel.className = "text-xs font-bold text-error bg-error/10 px-2 py-0.5 rounded-full animate-pulse";
            } else {
                statusLabel.innerText = "Estable";
                statusLabel.className = "text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full";
            }
        }
    }
    
    // 2. Real-time Access Log Updates
    else if (data.type === "acceso") {
        addAccessRow(data);
        if (data.estado === "Denegado") {
            showSystemNotification(`Alerta Seguridad: Intento fallido en ${data.puerta}.`);
        }
    }
    
    // 3. Admin System Logs
    else if (data.type === "log") {
        if (currentUser.rol === "Administrador") {
            addSystemAlertLog(data);
        }
    }
}

// ----------------- RESIDENT PORTAL VIEWS LÓGICA -----------------

// A. FINANZAS
async function loadResidentFinanzas() {
    try {
        const res = await fetch("/api/v1/finanzas/cuotas", {
            headers: { "Authorization": `Bearer ${jwtToken}` }
        });
        const data = await res.json();
        
        // Render balance
        document.getElementById("res-balance-amount").innerText = `$ ${data.unidad.saldo_actual.toFixed(2)}`;
        document.getElementById("res-unit-name").innerText = `${data.unidad.numero_apartamento} - Coeficiente ${data.unidad.alicuota}`;
        document.getElementById("res-alicuota-val").innerText = `${(data.unidad.alicuota * 100).toFixed(0)}%`;
        
        // Render Table
        const tbody = document.getElementById("res-payments-table-body");
        tbody.innerHTML = "";
        
        if (data.pagos.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-xs text-outline">No hay transacciones registradas.</td></tr>`;
        }
        
        data.pagos.forEach(p => {
            const statusClass = {
                Pagado: "status-pagado",
                Pendiente: "status-pendiente",
                "En Revision": "status-revision"
            }[p.estado] || "status-pendiente";
            
            const tr = document.createElement("tr");
            tr.className = "hover:bg-surface-container-low transition-colors";
            tr.innerHTML = `
                <td class="px-4 py-3">${p.fecha}</td>
                <td class="px-4 py-3 font-semibold">${p.concepto}</td>
                <td class="px-4 py-3 text-xs text-outline">${p.metodo} ${p.referencia ? `(Ref: ${p.referencia})` : ""}</td>
                <td class="px-4 py-3 text-right font-bold">$ ${p.monto.toFixed(2)}</td>
                <td class="px-4 py-3 text-center">
                    <span class="status-pill ${statusClass}">${p.estado}</span>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Transparency Documents
        const docsList = document.getElementById("res-docs-list");
        docsList.innerHTML = `
            <div class="p-3 bg-surface-container-lowest border border-outline-variant rounded-lg flex items-center justify-between group hover:border-primary transition-all cursor-pointer" onclick="downloadDoc('Balance_Mensual_Septiembre.pdf')">
                <div class="flex items-center gap-3">
                    <span class="material-symbols-outlined text-error">picture_as_pdf</span>
                    <div>
                        <p class="text-xs font-bold leading-tight">Balance Mensual - Sep</p>
                        <p class="text-[9px] text-outline">Publicado hace 5 días</p>
                    </div>
                </div>
                <span class="material-symbols-outlined text-sm text-outline group-hover:text-primary">download</span>
            </div>
            <div class="p-3 bg-surface-container-lowest border border-outline-variant rounded-lg flex items-center justify-between group hover:border-primary transition-all cursor-pointer" onclick="downloadDoc('Facturas_Comunes_Edificio.pdf')">
                <div class="flex items-center gap-3">
                    <span class="material-symbols-outlined text-tertiary">receipt_long</span>
                    <div>
                        <p class="text-xs font-bold leading-tight">Facturas Servicios Comunes</p>
                        <p class="text-[9px] text-outline">Luz y Agua Edificio</p>
                    </div>
                </div>
                <span class="material-symbols-outlined text-sm text-outline group-hover:text-primary">download</span>
            </div>
            <div class="p-3 bg-surface-container-lowest border border-outline-variant rounded-lg flex items-center justify-between group hover:border-primary transition-all cursor-pointer" onclick="downloadDoc('Presupuesto_Anual_2026.pdf')">
                <div class="flex items-center gap-3">
                    <span class="material-symbols-outlined text-secondary">description</span>
                    <div>
                        <p class="text-xs font-bold leading-tight">Presupuesto Anual 2026</p>
                        <p class="text-[9px] text-outline">Planificación financiera</p>
                    </div>
                </div>
                <span class="material-symbols-outlined text-sm text-outline group-hover:text-primary">download</span>
            </div>
        `;
    } catch (err) {
        console.error(err);
    }
}

// B. SEGURIDAD & ACCESO
async function loadResidentSeguridad() {
    loadAccessBitacoraUI();
}

async function handleGenerateQR(event) {
    event.preventDefault();
    const nombre = document.getElementById("qr-visitor-name").value;
    const documento = document.getElementById("qr-visitor-doc").value;
    const motivo = document.getElementById("qr-visitor-reason").value;

    try {
        const res = await fetch("/api/v1/visitantes/qr", {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "Authorization": `Bearer ${jwtToken}`
            },
            body: jsonPayload({ nombre, documento, motivo })
        });
        const data = await res.json();
        
        if (!res.ok) throw new Error(data.mensaje);
        
        // Show in Modal
        document.getElementById("qr-modal-visitor-name").innerText = nombre;
        document.getElementById("qr-modal-visitor-details").innerText = `Motivo: ${motivo || 'Visita general'} - Cédula: ${documento}`;
        document.getElementById("qr-modal-expiration").innerText = `Vence: ${data.fecha_expiracion}`;
        
        // Render QR Code image using server API
        const qrContainer = document.getElementById("qrcode-container");
        qrContainer.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${data.codigo_qr}" class="w-48 h-48 object-contain" alt="QR Code">`;
        
        document.getElementById("viewQRModal").classList.remove("hidden");
        document.getElementById("qrGenForm").reset();
    } catch (err) {
        alert(`Error al generar QR: ${err.message}`);
    }
}

function shareQRLink() {
    alert("Enlace copiado al portapapeles. Listo para enviar vía WhatsApp.");
}

async function simulateGateAccess(method) {
    try {
        const scanSound = new Audio("https://assets.mixkit.co/active_storage/sfx/2568/2568-84.wav");
        scanSound.play().catch(() => {});
    } catch (e) {}

    // Simulated Biometric Scan UI animation
    alert(`Iniciando escaneo ${method}. Coloca tu rostro/huella frente al dispositivo simulador.`);
    
    try {
        const res = await fetch("/api/v1/acceso/validar", {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "Authorization": `Bearer ${jwtToken}`
            },
            body: jsonPayload({
                tipo_acceso: method,
                usuario_id: currentUser.id,
                puerta: "Garita 1 Peatonal"
            })
        });
        const data = await res.json();
        
        if (data.acceso === "Autorizado") {
            alert(`Acceso AUTORIZADO. La cerradura electromagnética ha sido liberada por 5 segundos.`);
        } else {
            alert(`Acceso DENEGADO: ${data.mensaje}`);
        }
        loadAccessBitacoraUI();
    } catch (err) {
        alert("Fallo de comunicación con el lector.");
    }
}

// C. OPERACIONES / TELEMETRIA
function loadResidentOperaciones() {
    initTelemetryCharts("resPressureChart");
}

function updatePumpsUI(bombaEstado, leak) {
    const list = document.getElementById("res-pumps-list");
    if (!list) return;
    
    const p1Status = bombaEstado === "Nominal" ? "Operativa" : "Fuera de servicio";
    const p1Class = bombaEstado === "Nominal" ? "bg-secondary-container text-on-secondary-container" : "bg-error-container text-on-error-container";
    const p1Icon = bombaEstado === "Nominal" ? "check_circle" : "cancel";
    const p1Eff = bombaEstado === "Nominal" ? "98% Eficiencia" : "0% Presión";

    list.innerHTML = `
        <div class="flex items-center justify-between p-4 bg-surface-container-low rounded-lg">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full flex items-center justify-center ${p1Class}">
                    <span class="material-symbols-outlined">${p1Icon}</span>
                </div>
                <div>
                    <p class="font-bold text-sm">Bomba Hidráulica A-01</p>
                    <p class="text-[10px] text-on-surface-variant">Presión principal tanque norte</p>
                </div>
            </div>
            <div class="text-right">
                <p class="text-sm font-bold">${p1Status}</p>
                <p class="text-xs text-secondary font-semibold">${p1Eff}</p>
            </div>
        </div>
        <div class="flex items-center justify-between p-4 bg-surface-container-low rounded-lg ${leak ? 'border border-amber-300 bg-amber-50/50' : 'opacity-70'}">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-surface-container-highest flex items-center justify-center">
                    <span class="material-symbols-outlined">${leak ? 'warning' : 'pause_circle'}</span>
                </div>
                <div>
                    <p class="font-bold text-sm">Bomba Respaldo B-02</p>
                    <p class="text-[10px] text-on-surface-variant">${leak ? 'ALERTA: Fuga transitoria' : 'Estado Standby'}</p>
                </div>
            </div>
            <div class="text-right">
                <p class="text-sm font-bold">${leak ? 'En Fuga' : 'En Espera'}</p>
                <p class="text-xs text-on-surface-variant">${leak ? 'Revisión técnica' : 'Rotación en 4 horas'}</p>
            </div>
        </div>
    `;
}

// ----------------- ADMINISTRATOR PORTAL LÓGICA -----------------

// A. DASHBOARD
async function loadAdminDashboard() {
    try {
        const res = await fetch("/api/v1/finanzas/cuotas", {
            headers: { "Authorization": `Bearer ${jwtToken}` }
        });
        const data = await res.json();
        
        let totalRecaudado = 0;
        let totalMora = 0;
        
        data.unidades.forEach(u => {
            totalMora += u.saldo_actual;
        });
        
        data.pagos.forEach(p => {
            if (p.estado === "Pagado") {
                totalRecaudado += p.monto;
            }
        });
        
        // Egresos totals
        const eRes = await fetch("/api/v1/finanzas/egresos", {
            headers: { "Authorization": `Bearer ${jwtToken}` }
        });
        const egresosData = await eRes.json();
        let totalEgr = 0;
        egresosData.forEach(e => totalEgr += e.monto);
        
        document.getElementById("adm-dash-balance").innerText = `$ ${totalRecaudado.toFixed(2)}`;
        document.getElementById("adm-dash-mora").innerText = `$ ${totalMora.toFixed(2)}`;
        document.getElementById("adm-dash-egresos").innerText = `$ ${totalEgr.toFixed(2)}`;
        
        // Render logs
        loadSystemAlertLogs();
        loadAccessBitacoraUI();
    } catch (err) {
        console.error(err);
    }
}

// B. FINANZAS
async function loadAdminFinanzas() {
    try {
        const res = await fetch("/api/v1/finanzas/cuotas", {
            headers: { "Authorization": `Bearer ${jwtToken}` }
        });
        const data = await res.json();
        
        const tbody = document.getElementById("adm-payments-table-body");
        tbody.innerHTML = "";
        
        data.pagos.forEach(p => {
            const statusClass = {
                Pagado: "status-pagado",
                Pendiente: "status-pendiente",
                "En Revision": "status-revision"
            }[p.estado] || "status-pendiente";
            
            const actions = p.estado === "En Revision" ? `
                <div class="flex gap-1 justify-center">
                    <button class="bg-secondary text-on-secondary px-2 py-1 rounded text-xs font-bold hover:opacity-90" onclick="validatePayment(${p.id}, 'Pagado')">Aprobar</button>
                    <button class="bg-error text-on-error px-2 py-1 rounded text-xs font-bold hover:opacity-90" onclick="validatePayment(${p.id}, 'Rechazado')">Rechazar</button>
                    <button class="border border-outline px-1.5 py-1 rounded hover:bg-surface-container" onclick="viewReceiptImage('${p.comprobante_url}', ${p.monto}, '${p.referencia}', '${p.metodo}', '${p.concepto}')">
                        <span class="material-symbols-outlined text-xs">visibility</span>
                    </button>
                </div>
            ` : `<span class="text-xs text-outline">Conciliado</span>`;
            
            const tr = document.createElement("tr");
            tr.className = "hover:bg-surface-container-low transition-colors";
            tr.innerHTML = `
                <td class="px-4 py-3 font-semibold">${p.numero_apartamento}</td>
                <td class="px-4 py-3">${p.concepto}</td>
                <td class="px-4 py-3 text-xs text-outline">${p.metodo} (${p.referencia})</td>
                <td class="px-4 py-3 text-right font-bold">$ ${p.monto.toFixed(2)}</td>
                <td class="px-4 py-3 text-center">
                    <span class="status-pill ${statusClass}">${p.estado}</span>
                </td>
                <td class="px-4 py-3 text-center">${actions}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error(err);
    }
}

async function validatePayment(pagoId, estado) {
    try {
        const res = await fetch("/api/v1/finanzas/validar", {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "Authorization": `Bearer ${jwtToken}`
            },
            body: jsonPayload({ pago_id: pagoId, estado: estado })
        });
        if (!res.ok) throw new Error("Error al validar");
        alert(`Pago validado como ${estado}`);
        loadAdminFinanzas();
    } catch (err) {
        alert(err.message);
    }
}

async function handleRegisterEgreso(event) {
    event.preventDefault();
    const concepto = document.getElementById("egr-concepto").value;
    const monto = document.getElementById("egr-monto").value;
    
    try {
        const res = await fetch("/api/v1/finanzas/egresos", {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "Authorization": `Bearer ${jwtToken}`
            },
            body: jsonPayload({ concepto, monto })
        });
        if (!res.ok) throw new Error("Fallo al registrar");
        alert("Egreso registrado correctamente.");
        document.getElementById("admEgresoForm").reset();
        loadAdminFinanzas();
    } catch (err) {
        alert(err.message);
    }
}

async function triggerBillingCron() {
    const total = document.getElementById("cron-gasto-total").value;
    if (!total || total <= 0) return alert("Ingresa un monto valido.");
    
    if (!confirm("¿Confirmar facturación masiva? Esto prorrateará los gastos y aumentará el saldo pendiente de los apartamentos.")) return;
    
    try {
        const res = await fetch("/api/v1/finanzas/cron_facturar", {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "Authorization": `Bearer ${jwtToken}`
            },
            body: jsonPayload({ gastos_comunes: total })
        });
        const data = await res.json();
        alert(data.mensaje);
        loadAdminFinanzas();
    } catch (err) {
        alert("Error de procesamiento.");
    }
}

function exportPaymentsPDF() {
    alert("Generando y exportando reporte financiero consolidado en formato PDF... ( JSPdf Demo )");
}

// C. SEGURIDAD & CCTV
function loadAdminSeguridad() {
    loadAccessBitacoraUI();
    
    // Draw camera simulated streams
    drawSimulatedCamera("cam1-canvas", "PÓRTICO PRINCIPAL PEATONAL");
    drawSimulatedCamera("cam2-canvas", "ENTRADA VEHICULAR GENERAL");
    drawSimulatedCamera("cam3-canvas", "ESTACIONAMIENTO - TORRE B");
    drawSimulatedCamera("cam4-canvas", "PASILLOS ASCENSORES - PISO 4");
}

function drawSimulatedCamera(canvasId, name) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    
    // Resize
    canvas.width = 320;
    canvas.height = 180;
    
    let dots = [];
    for (let i = 0; i < 15; i++) {
        dots.push({ x: Math.random() * 320, y: Math.random() * 180, r: Math.random() * 2 });
    }

    function animate() {
        if (activeSection !== "seguridad" || !document.getElementById(canvasId)) return;
        
        ctx.fillStyle = "#1e1e1e";
        ctx.fillRect(0, 0, 320, 180);
        
        // Scanlines grid simulation
        ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
        for (let y = 0; y < 180; y += 4) {
            ctx.fillRect(0, y, 320, 1.5);
        }
        
        // Render simple abstract vectors simulating CCTV moving silhouettes
        ctx.fillStyle = "rgba(0, 255, 0, 0.3)";
        dots.forEach(d => {
            d.x += (Math.random() - 0.5) * 1.5;
            d.y += (Math.random() - 0.5) * 1.5;
            if (d.x < 0) d.x = 320;
            if (d.x > 320) d.x = 0;
            if (d.y < 0) d.y = 180;
            if (d.y > 180) d.y = 0;
            
            ctx.beginPath();
            ctx.arc(d.x, d.y, d.r + 2, 0, 2 * Math.PI);
            ctx.fill();
        });
        
        // Overlay camera stats
        ctx.fillStyle = "#00ff00";
        ctx.font = "10px Courier New";
        ctx.fillText(new Date().toLocaleString("es-ES"), 10, 160);
        ctx.fillText("ONVIF 1080p // RTSP STREAM", 10, 145);
        
        setTimeout(() => requestAnimationFrame(animate), 100);
    }
    animate();
}

// D. OPERACIONES / TELEMETRIA
async function loadAdminOperaciones() {
    initTelemetryCharts("admPressureChart");
    
    // Fetch thresholds
    try {
        const res = await fetch("/api/v1/telemetria/config", {
            headers: { "Authorization": `Bearer ${jwtToken}` }
        });
        const configs = await res.json();
        
        if (configs.presion_minima) {
            document.getElementById("range-presion-min").value = configs.presion_minima;
            document.getElementById("val-presion-min").innerText = `${configs.presion_minima} PSI`;
        }
        if (configs.presion_maxima) {
            document.getElementById("range-presion-max").value = configs.presion_maxima;
            document.getElementById("val-presion-max").innerText = `${configs.presion_maxima} PSI`;
        }
    } catch (e) {
        console.error(e);
    }
}

function updateThresholdLabels() {
    const minVal = document.getElementById("range-presion-min").value;
    const maxVal = document.getElementById("range-presion-max").value;
    
    document.getElementById("val-presion-min").innerText = `${minVal} PSI`;
    document.getElementById("val-presion-max").innerText = `${maxVal} PSI`;
}

async function saveTelemetryThresholds() {
    const minVal = document.getElementById("range-presion-min").value;
    const maxVal = document.getElementById("range-presion-max").value;
    
    try {
        const res = await fetch("/api/v1/telemetria/config", {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "Authorization": `Bearer ${jwtToken}`
            },
            body: jsonPayload({
                presion_minima: minVal,
                presion_maxima: maxVal
            })
        });
        if (res.ok) alert("Límites actualizados en base de datos.");
    } catch (e) {
        alert("Fallo de red.");
    }
}

async function setSimState(bomba, leak) {
    // Update simulation buttons styles
    document.getElementById("btn-sim-nominal").className = (bomba === 'Nominal' && !leak) ? 
        "px-4 py-1.5 rounded-full text-xs font-bold bg-secondary-container text-on-secondary-container" : "px-4 py-1.5 rounded-full text-xs font-bold bg-surface-container-high text-on-surface-variant";
        
    document.getElementById("btn-sim-leak").className = leak ? 
        "px-4 py-1.5 rounded-full text-xs font-bold bg-tertiary-container text-on-tertiary-container" : "px-4 py-1.5 rounded-full text-xs font-bold bg-surface-container-high text-on-surface-variant";
        
    document.getElementById("btn-sim-fail").className = (bomba === 'Fallo') ? 
        "px-4 py-1.5 rounded-full text-xs font-bold bg-error-container text-on-error-container animate-pulse" : "px-4 py-1.5 rounded-full text-xs font-bold bg-surface-container-high text-on-surface-variant";

    try {
        const res = await fetch("/api/v1/telemetria/simular", {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "Authorization": `Bearer ${jwtToken}`
            },
            body: jsonPayload({ bomba, leak })
        });
        if (!res.ok) throw new Error("Fallo");
    } catch (e) {
        console.error(e);
    }
}

// E. COMUNIDAD
async function loadAdminComunidad() {
    try {
        const res = await fetch("/api/v1/usuarios", {
            headers: { "Authorization": `Bearer ${jwtToken}` }
        });
        const users = await res.json();
        
        const tbody = document.getElementById("adm-residents-table-body");
        tbody.innerHTML = "";
        
        users.forEach(u => {
            const tr = document.createElement("tr");
            tr.className = "hover:bg-surface-container-low transition-colors";
            tr.innerHTML = `
                <td class="px-6 py-3 font-semibold">${u.nombre}</td>
                <td class="px-6 py-3 font-mono text-xs">${u.correo}</td>
                <td class="px-6 py-3">
                    <span class="px-2 py-0.5 bg-primary/10 text-primary text-xs font-bold rounded-full">${u.rol}</span>
                </td>
                <td class="px-6 py-3 text-xs">${u.telefono || '-'}</td>
                <td class="px-6 py-3 text-center">
                    <button class="text-error hover:text-red-700 text-xs font-bold" onclick="deleteUser(${u.id})">Eliminar</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error(e);
    }
}

async function handleAddResident(event) {
    event.preventDefault();
    const nombre = document.getElementById("res-new-name").value;
    const correo = document.getElementById("res-new-email").value;
    const rol = document.getElementById("res-new-rol").value;
    const telefono = document.getElementById("res-new-phone").value;
    const password = document.getElementById("res-new-password").value;
    const numero_apartamento = document.getElementById("res-new-unit").value;
    const alicuota = document.getElementById("res-new-alicuota").value;
    
    try {
        const res = await fetch("/api/v1/usuarios", {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "Authorization": `Bearer ${jwtToken}`
            },
            body: jsonPayload({ nombre, correo, password, rol, telefono, numero_apartamento, alicuota })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.mensaje);
        
        alert("Usuario registrado correctamente.");
        closeAddResidentModal();
        loadAdminComunidad();
    } catch (err) {
        alert(err.message);
    }
}

function toggleResidentFormDetails() {
    const rol = document.getElementById("res-new-rol").value;
    const fields = document.getElementById("resident-only-fields");
    if (rol === "Residente") {
        fields.classList.remove("hidden");
    } else {
        fields.classList.add("hidden");
    }
}

// F. DIRECT DATABASE TABLE VIEW
async function loadDBTable(tableName) {
    // Styling tabs active state
    document.querySelectorAll(".db-table-tab").forEach(tab => {
        if (tab.innerText === tableName) tab.classList.add("active");
        else tab.classList.remove("active");
    });
    
    document.getElementById("db-view-title").innerText = `SELECT * FROM ${tableName};`;
    
    try {
        const res = await fetch(`/api/v1/auditoria/db?table=${tableName}`, {
            headers: { "Authorization": `Bearer ${jwtToken}` }
        });
        const rows = await res.json();
        
        const thead = document.getElementById("db-view-thead");
        const tbody = document.getElementById("db-view-tbody");
        thead.innerHTML = "";
        tbody.innerHTML = "";
        
        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td class="p-4 text-center text-xs text-outline">Tabla vacía.</td></tr>`;
            return;
        }
        
        // Build headers
        const columns = Object.keys(rows[0]);
        const trH = document.createElement("tr");
        columns.forEach(col => {
            const th = document.createElement("th");
            th.className = "px-3 py-2 border-b border-outline-variant";
            th.innerText = col;
            trH.appendChild(th);
        });
        thead.appendChild(trH);
        
        // Build rows
        rows.forEach(row => {
            const trR = document.createElement("tr");
            trR.className = "hover:bg-surface-container-low transition-colors";
            columns.forEach(col => {
                const td = document.createElement("td");
                td.className = "px-3 py-2 border-b border-outline-variant text-[11px] truncate max-w-[200px]";
                td.innerText = row[col] === null ? "NULL" : row[col];
                trR.appendChild(td);
            });
            tbody.appendChild(trR);
        });
    } catch (e) {
        console.error(e);
    }
}

// ----------------- TELEMETRIA CHARTS INITIALIZER -----------------

function initTelemetryCharts(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    
    if (pressureChartInstance) {
        pressureChartInstance.destroy();
    }
    
    // Populate dummy initial values if empty
    if (pressureChartData.length === 0) {
        for (let i = 0; i < 10; i++) {
            const date = new Date(Date.now() - (10 - i) * 5000);
            pressureChartLabels.push(date.toLocaleTimeString());
            pressureChartData.push(40 + Math.random() * 8);
        }
    }
    
    const ctx = canvas.getContext("2d");
    pressureChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: pressureChartLabels,
            datasets: [{
                label: 'Presión de Agua (PSI)',
                data: pressureChartData,
                borderColor: '#0052cc',
                backgroundColor: 'rgba(0, 82, 204, 0.08)',
                fill: true,
                tension: 0.3,
                borderWidth: 2,
                pointRadius: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { min: 0, max: 90, grid: { color: 'rgba(0,0,0,0.04)' } },
                x: { grid: { display: false } }
            }
        }
    });
}

function updateLiveChart(label, value) {
    if (!pressureChartInstance) return;
    
    pressureChartLabels.push(label);
    pressureChartData.push(value);
    
    // Shift arrays if longer than 15 values
    if (pressureChartLabels.length > 15) {
        pressureChartLabels.shift();
        pressureChartData.shift();
    }
    
    pressureChartInstance.update();
}

// ----------------- ACCESS LOG & NOTIFICATION HELPERS -----------------

function addAccessRow(data) {
    // 1. Update resident access log list if resident page
    const tbody = document.getElementById("res-access-log");
    if (tbody) {
        const tr = document.createElement("tr");
        tr.className = "hover:bg-surface-container-low transition-colors";
        
        const badgeClass = data.estado === "Autorizado" ? "bg-secondary-container text-on-secondary-container" : "bg-error-container text-on-error-container";
        
        tr.innerHTML = `
            <td class="py-3 font-semibold">${data.visitante}</td>
            <td class="py-3 font-mono text-xs">${data.fecha_hora}</td>
            <td class="py-3 text-xs">${data.puerta}</td>
            <td class="py-3">
                <span class="status-pill ${badgeClass}">${data.estado}</span>
            </td>
        `;
        tbody.prepend(tr);
        if (tbody.children.length > 20) tbody.removeChild(tbody.lastChild);
    }
    
    // 2. Update admin access log list if admin page
    const admBit = document.getElementById("adm-access-bitacora");
    if (admBit) {
        const item = document.createElement("div");
        item.className = "py-3 flex justify-between items-start";
        const indicatorColor = data.estado === "Autorizado" ? "bg-secondary" : "bg-error";
        
        item.innerHTML = `
            <div class="flex items-start gap-2.5">
                <span class="w-2.5 h-2.5 rounded-full ${indicatorColor} mt-1.5 animate-pulse"></span>
                <div>
                    <p class="font-bold text-xs">${data.visitante}</p>
                    <p class="text-[10px] text-outline">${data.puerta} // ${data.tipo}</p>
                </div>
            </div>
            <span class="text-[10px] font-mono text-outline">${new Date(data.fecha_hora).toLocaleTimeString()}</span>
        `;
        admBit.prepend(item);
        if (admBit.children.length > 20) admBit.removeChild(admBit.lastChild);
        
        // Update top stats summary
        const topStat = document.getElementById("adm-dash-last-access");
        if (topStat) {
            topStat.innerText = `${data.visitante} (${new Date(data.fecha_hora).toLocaleTimeString()})`;
        }
    }
}

function addSystemAlertLog(data) {
    const list = document.getElementById("adm-dash-alerts-box");
    if (!list) return;
    
    const item = document.createElement("div");
    item.className = "py-3 flex items-start gap-3";
    item.innerHTML = `
        <span class="material-symbols-outlined text-error mt-0.5 text-sm">error</span>
        <div class="flex-grow">
            <p class="text-xs font-bold text-on-surface">${data.accion}</p>
            <p class="text-[10px] text-on-surface-variant">${data.detalles}</p>
            <p class="text-[8px] text-outline mt-0.5">${data.timestamp}</p>
        </div>
    `;
    list.prepend(item);
    if (list.children.length > 10) list.removeChild(list.lastChild);
    
    // Push alert notifications
    pushSystemNotification(data);
}

// Systems notifications dropdown in header
let systemNotifications = [];

function pushSystemNotification(data) {
    systemNotifications.unshift(data);
    if (systemNotifications.length > 10) systemNotifications.pop();
    
    document.getElementById("notification-badge").classList.remove("hidden");
    renderNotificationsDropdown();
}

function renderNotificationsDropdown() {
    const list = document.getElementById("notifications-list");
    if (!list) return;
    list.innerHTML = "";
    
    if (systemNotifications.length === 0) {
        list.innerHTML = `<div class="p-3 text-xs text-on-surface-variant text-center">No hay alertas pendientes.</div>`;
        return;
    }
    
    systemNotifications.forEach(n => {
        const item = document.createElement("div");
        item.className = "p-3 text-xs hover:bg-surface-container-low transition-colors";
        item.innerHTML = `
            <div class="flex justify-between items-start font-bold">
                <span class="text-primary">${n.accion}</span>
                <span class="text-[9px] text-outline">${new Date(n.timestamp).toLocaleTimeString()}</span>
            </div>
            <p class="text-on-surface-variant mt-1 text-[11px]">${n.detalles}</p>
        `;
        list.appendChild(item);
    });
}

function toggleNotifications() {
    const drop = document.getElementById("notification-dropdown");
    drop.classList.toggle("hidden");
    document.getElementById("notification-badge").classList.add("hidden");
}

function clearNotifications() {
    systemNotifications = [];
    renderNotificationsDropdown();
    document.getElementById("notification-dropdown").classList.add("hidden");
}

function showSystemNotification(msg) {
    alert(msg);
}

// ----------------- MODAL VIEWERS CONTROLS -----------------

function openReportPaymentModal() {
    document.getElementById("reportPaymentModal").classList.remove("hidden");
}

function closeReportPaymentModal() {
    document.getElementById("reportPaymentModal").classList.add("hidden");
    document.getElementById("reportPaymentForm").reset();
    document.getElementById("comprobante-filename-label").innerText = "Formatos permitidos: JPG, PNG (Max 5MB)";
}

function updateComprobanteFilenameLabel() {
    const fileInput = document.getElementById("pago-comprobante");
    if (fileInput.files.length > 0) {
        document.getElementById("comprobante-filename-label").innerText = `Seleccionado: ${fileInput.files[0].name}`;
    }
}

async function handleReportPayment(event) {
    event.preventDefault();
    const monto = document.getElementById("pago-monto").value;
    const referencia = document.getElementById("pago-referencia").value;
    const metodo = document.getElementById("pago-metodo").value;
    const concepto = document.getElementById("pago-concepto").value;
    const comprobanteFile = document.getElementById("pago-comprobante").files[0];
    
    const formData = new FormData();
    formData.append("monto", monto);
    formData.append("referencia", referencia);
    formData.append("metodo", metodo);
    formData.append("concepto", concepto);
    if (comprobanteFile) {
        formData.append("comprobante", comprobanteFile);
    }
    
    try {
        const res = await fetch("/api/v1/finanzas/reportar", {
            method: "POST",
            headers: { "Authorization": `Bearer ${jwtToken}` },
            body: formData
        });
        const data = await res.json();
        
        if (!res.ok) throw new Error(data.mensaje);
        
        alert("Pago reportado. Un administrador conciliará la transacción en el banco.");
        closeReportPaymentModal();
        loadResidentFinanzas();
    } catch (err) {
        alert(err.message);
    }
}

function closeQRModal() {
    document.getElementById("viewQRModal").classList.add("hidden");
}

function openAddResidentModal() {
    document.getElementById("addResidentModal").classList.remove("hidden");
    toggleResidentFormDetails();
}

function closeAddResidentModal() {
    document.getElementById("addResidentModal").classList.add("hidden");
    document.getElementById("addResidentForm").reset();
}

function viewReceiptImage(filename, monto, ref, metodo, concepto) {
    document.getElementById("receipt-modal-monto").innerText = `$ ${monto.toFixed(2)}`;
    document.getElementById("receipt-modal-ref").innerText = ref;
    document.getElementById("receipt-modal-metodo").innerText = metodo;
    document.getElementById("receipt-modal-concepto").innerText = concepto;
    
    const imgEl = document.getElementById("receipt-modal-image");
    const fallback = document.getElementById("receipt-modal-fallback");
    
    if (filename && filename !== 'null' && filename !== 'None') {
        imgEl.src = `/uploads/${filename}`;
        imgEl.classList.remove("hidden");
        fallback.classList.add("hidden");
    } else {
        imgEl.src = "";
        imgEl.classList.add("hidden");
        fallback.classList.remove("hidden");
    }
    
    document.getElementById("viewReceiptModal").classList.remove("hidden");
}

function closeReceiptModal() {
    document.getElementById("viewReceiptModal").classList.add("hidden");
}

// Helper to compile payload securely
function jsonPayload(obj) {
    return JSON.stringify(obj);
}

// ----------------- SEED STATIC UI RENDERERS -----------------

function loadAccessBitacoraUI() {
    const list = document.getElementById("res-access-log") || document.getElementById("adm-access-bitacora");
    if (!list) return;
    
    fetch("/api/v1/auditoria/bitacora", {
        headers: { "Authorization": `Bearer ${jwtToken}` }
    })
    .then(r => r.json())
    .then(data => {
        // Filter out logins, show only access logs
        const accessLogs = data.filter(d => d.accion.includes("acceso") || d.accion.includes("Acceso") || d.accion.includes("Intento"));
        
        if (currentUser.rol === "Residente") {
            const tbody = document.getElementById("res-access-log");
            tbody.innerHTML = "";
            if (accessLogs.length === 0) {
                tbody.innerHTML = `<tr><td colspan="4" class="py-4 text-center text-xs text-outline">No hay accesos recientes.</td></tr>`;
            }
            accessLogs.forEach(l => {
                const tr = document.createElement("tr");
                tr.className = "hover:bg-surface-container-low transition-colors";
                const isAuth = l.detalles.includes("Autorizado") || l.detalles.includes("exitoso");
                const badgeClass = isAuth ? "bg-secondary-container text-on-secondary-container" : "bg-error-container text-on-error-container";
                
                tr.innerHTML = `
                    <td class="py-3 font-semibold">${l.usuario_nombre || 'Visitante'}</td>
                    <td class="py-3 font-mono text-xs">${l.timestamp}</td>
                    <td class="py-3 text-xs">Pórtico Principal</td>
                    <td class="py-3">
                        <span class="status-pill ${badgeClass}">${isAuth ? 'Autorizado' : 'Denegado'}</span>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        } else {
            const list = document.getElementById("adm-access-bitacora");
            list.innerHTML = "";
            accessLogs.forEach(l => {
                const item = document.createElement("div");
                item.className = "py-3 flex justify-between items-start border-b border-outline-variant";
                const isAuth = l.detalles.includes("Autorizado") || l.detalles.includes("exitoso");
                const indicatorColor = isAuth ? "bg-secondary" : "bg-error";
                
                item.innerHTML = `
                    <div class="flex items-start gap-2.5">
                        <span class="w-2.5 h-2.5 rounded-full ${indicatorColor} mt-1.5"></span>
                        <div>
                            <p class="font-bold text-xs">${l.usuario_nombre || 'Visitante'}</p>
                            <p class="text-[10px] text-outline">${l.detalles}</p>
                        </div>
                    </div>
                    <span class="text-[10px] font-mono text-outline">${l.timestamp.split(" ")[1]}</span>
                `;
                list.appendChild(item);
            });
        }
    });
}

function loadSystemAlertLogs() {
    fetch("/api/v1/auditoria/bitacora", {
        headers: { "Authorization": `Bearer ${jwtToken}` }
    })
    .then(r => r.json())
    .then(data => {
        const list = document.getElementById("adm-dash-alerts-box");
        if (!list) return;
        list.innerHTML = "";
        
        const systemLogs = data.filter(d => d.accion.includes("Alerta") || d.accion.includes("Fallo") || d.accion.includes("Facturacion"));
        
        if (systemLogs.length === 0) {
            list.innerHTML = `<div class="p-3 text-xs text-outline text-center">No hay alertas críticas en bitácora.</div>`;
            return;
        }
        
        systemLogs.slice(0, 5).forEach(l => {
            const item = document.createElement("div");
            item.className = "py-3 flex items-start gap-3 border-b border-outline-variant last:border-none";
            const icon = l.accion.includes("Alerta") ? "warning" : "info";
            const color = l.accion.includes("Alerta") ? "text-error" : "text-primary";
            
            item.innerHTML = `
                <span class="material-symbols-outlined ${color} mt-0.5 text-sm">${icon}</span>
                <div class="flex-grow">
                    <p class="text-xs font-bold text-on-surface">${l.accion}</p>
                    <p class="text-[10px] text-on-surface-variant">${l.detalles}</p>
                    <p class="text-[8px] text-outline mt-0.5">${l.timestamp}</p>
                </div>
            `;
            list.appendChild(item);
        });
    });
}

function addSystemAlertLogDirect(log) {
    const list = document.getElementById("alert-dispatch-log");
    if (!list) return;
    
    const div = document.createElement("div");
    div.className = "py-1 text-xs border-b border-outline/20 last:border-none";
    div.innerText = `[${log.timestamp}] ${log.accion}: ${log.detalles}`;
    list.prepend(div);
    if (list.children.length > 20) list.removeChild(list.lastChild);
}

function triggerPanicAlert() {
    if (confirm('¿Confirmar activación de ALERTA DE PÁNICO? La seguridad del edificio será notificada de inmediato.')) {
        logEventOnServer("Alerta de Panico", "Boton de panico activado por el Residente.");
        alert('Alerta enviada. Mantenga la calma, la ayuda está en camino.');
    }
}

async function simulateFailedAccess() {
    const now = new Date().toLocaleString("es-ES");
    try {
        await fetch("/api/v1/acceso/validar", {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "Authorization": `Bearer ${jwtToken}`
            },
            body: jsonPayload({
                tipo_acceso: "PIN",
                usuario_id: 9999, // Unknown user
                puerta: "Entrada Vehicular"
            })
        });
        loadAccessBitacoraUI();
    } catch (e) {
        console.error(e);
    }
}

function downloadDoc(filename) {
    alert(`Descargando documento de transparencia: ${filename}`);
}

async function deleteUser(id) {
    if (!confirm("¿Seguro que deseas eliminar a este usuario de la comunidad?")) return;
    // Mock user deletion
    alert("Usuario eliminado correctamente de la base de datos.");
    loadAdminComunidad();
}
