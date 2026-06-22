import sqlite3
import os
import bcrypt
import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "condosmart.db")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    print("Initializing SQLite Database...")
    conn = get_db_connection()
    cursor = conn.cursor()

    # Enable foreign keys
    cursor.execute("PRAGMA foreign_keys = ON;")

    # 1. Table: usuarios
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        correo TEXT UNIQUE NOT NULL,
        password_crypted TEXT NOT NULL,
        rol TEXT NOT NULL CHECK(rol IN ('Administrador', 'Residente', 'Vigilante', 'Tecnico')),
        telefono TEXT
    );
    """)

    # 2. Table: unidades
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS unidades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        numero_apartamento TEXT UNIQUE NOT NULL,
        residente_id INTEGER,
        saldo_actual REAL DEFAULT 0.0,
        alicuota REAL NOT NULL,
        FOREIGN KEY (residente_id) REFERENCES usuarios(id) ON DELETE SET NULL
    );
    """)

    # 3. Table: pagos
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS pagos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        unidad_id INTEGER NOT NULL,
        monto REAL NOT NULL,
        fecha TEXT NOT NULL,
        referencia TEXT NOT NULL,
        metodo TEXT NOT NULL,
        concepto TEXT NOT NULL,
        estado TEXT NOT NULL CHECK(estado IN ('Pendiente', 'Pagado', 'Rechazado', 'En Revision', 'Verificado')),
        comprobante_url TEXT,
        proveedor_id INTEGER,
        fecha_verificacion TEXT,
        FOREIGN KEY (unidad_id) REFERENCES unidades(id) ON DELETE CASCADE,
        FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE SET NULL
    );
    """)

    # 4. Table: egresos
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS egresos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        concepto TEXT NOT NULL,
        monto REAL NOT NULL,
        fecha TEXT NOT NULL,
        soporte_pdf TEXT,
        proveedor_id INTEGER,
        FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE SET NULL
    );
    """)

    # 5. Table: accesos
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS accesos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER,
        nombre_visitante TEXT,
        fecha_hora TEXT NOT NULL,
        tipo_acceso TEXT NOT NULL CHECK(tipo_acceso IN ('Biometrico', 'QR', 'PIN', 'Tag NFC')),
        estado TEXT NOT NULL CHECK(estado IN ('Autorizado', 'Denegado')),
        puerta TEXT NOT NULL,
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
    );
    """)

    # 6. Table: telemetria
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS telemetria (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        presion_psi REAL NOT NULL,
        timestamp TEXT NOT NULL,
        bomba_estado TEXT NOT NULL
    );
    """)

    # 7. Table: bitacora
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS bitacora (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER,
        accion TEXT NOT NULL,
        detalles TEXT,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
    );
    """)

    # 8. Table: visitantes
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS visitantes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        documento TEXT NOT NULL,
        motivo_visita TEXT,
        residente_id INTEGER NOT NULL,
        codigo_qr TEXT UNIQUE NOT NULL,
        fecha_expiracion TEXT NOT NULL,
        estado TEXT NOT NULL CHECK(estado IN ('Autorizado', 'Expirado', 'Usado')),
        FOREIGN KEY (residente_id) REFERENCES usuarios(id) ON DELETE CASCADE
    );
    """)

    # 9. Table: configuracion_sistema
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS configuracion_sistema (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parametro TEXT UNIQUE NOT NULL,
        valor TEXT NOT NULL,
        fecha_actualizacion TEXT NOT NULL
    );
    """)

    # 10. Table: proveedores (NUEVA)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS proveedores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        tipo_servicio TEXT NOT NULL,
        cuenta_bancaria TEXT NOT NULL,
        banco TEXT NOT NULL,
        rif TEXT,
        telefono TEXT,
        email TEXT,
        contacto_nombre TEXT,
        fecha_registro TEXT NOT NULL
    );
    """)

    # 11. Table: verificaciones_bancarias (NUEVA)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS verificaciones_bancarias (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pago_id INTEGER NOT NULL,
        referencia TEXT NOT NULL,
        monto REAL NOT NULL,
        fecha_verificacion TEXT NOT NULL,
        estado TEXT NOT NULL CHECK(estado IN ('exitoso', 'fallido', 'pendiente')),
        mensaje TEXT,
        respuesta_banco TEXT,
        FOREIGN KEY (pago_id) REFERENCES pagos(id) ON DELETE CASCADE
    );
    """)

    conn.commit()
    print("Tables created successfully.")
    seed_data(conn)
    conn.close()

def seed_data(conn):
    cursor = conn.cursor()
    
    # Check if users already exist to avoid duplicate seeding
    cursor.execute("SELECT COUNT(*) FROM usuarios;")
    if cursor.fetchone()[0] > 0:
        print("Database already seeded. Skipping.")
        return

    print("Seeding initial demo data...")
    
    # Create demo passwords hashes
    admin_hash = bcrypt.hashpw(b"admin123", bcrypt.gensalt()).decode('utf-8')
    res_hash = bcrypt.hashpw(b"residente123", bcrypt.gensalt()).decode('utf-8')
    vig_hash = bcrypt.hashpw(b"vigilante123", bcrypt.gensalt()).decode('utf-8')
    tec_hash = bcrypt.hashpw(b"tecnico123", bcrypt.gensalt()).decode('utf-8')

    users = [
        ("Administrador Principal", "admin@condosmart.com", admin_hash, "Administrador", "+584121111111"),
        ("Residente Propietario", "residente@condosmart.com", res_hash, "Residente", "+584122222222"),
        ("Vigilante de Turno", "vigilante@condosmart.com", vig_hash, "Vigilante", "+584123333333"),
        ("Tecnico de Mantenimiento", "tecnico@condosmart.com", tec_hash, "Tecnico", "+584124444444"),
        ("Sofia Mendoza", "sofia@condosmart.com", res_hash, "Residente", "+584125555555"),
        ("Carlos Ruiz", "carlos.ruiz@condosmart.com", res_hash, "Residente", "+584126666666")
    ]
    cursor.executemany("""
    INSERT INTO usuarios (nombre, correo, password_crypted, rol, telefono)
    VALUES (?, ?, ?, ?, ?);
    """, users)

    # Fetch user ids
    cursor.execute("SELECT id, correo FROM usuarios;")
    user_map = {row['correo']: row['id'] for row in cursor.fetchall()}

    unidades = [
        ("Torre B - 402", user_map['residente@condosmart.com'], 1240.00, 0.35),
        ("Torre B - 105", user_map['sofia@condosmart.com'], 450.00, 0.25),
        ("Torre A - 301", user_map['carlos.ruiz@condosmart.com'], 120.00, 0.20),
        ("Torre C - 202", None, 0.00, 0.20)
    ]
    cursor.executemany("""
    INSERT INTO unidades (numero_apartamento, residente_id, saldo_actual, alicuota)
    VALUES (?, ?, ?, ?);
    """, unidades)

    # Fetch unit ids
    cursor.execute("SELECT id, numero_apartamento FROM unidades;")
    unit_map = {row['numero_apartamento']: row['id'] for row in cursor.fetchall()}

    # ========== INSERTAR PROVEEDORES ==========
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    proveedores = [
        ("Hidrocapital", "agua", "0102-0123-45-6789012345", "Banesco", "J-12345678-9", "0212-555-0000", "facturacion@hidrocapital.gob.ve", "Juan Perez", now),
        ("Corpoelec", "luz", "0105-9876-54-3210987654", "Mercantil", "J-87654321-0", "0212-555-1111", "facturas@corpoelec.com.ve", "Maria Gonzalez", now),
        ("Seguridad Total C.A.", "seguridad", "0108-4567-89-1234567890", "Provincial", "J-11223344-5", "0212-555-2222", "ventas@seguridadtotal.com", "Carlos Rodriguez", now),
        ("Ascensores Modernos", "ascensor", "0114-7890-12-3456789012", "Venezuela", "J-99887766-3", "0212-555-3333", "servicio@ascensoresmodernos.com", "Ana Martinez", now),
        ("Limpieza Profesional C.A.", "limpieza", "0116-3456-78-9012345678", "BOD", "J-44556677-8", "0212-555-4444", "contacto@limpiezaprofesional.com", "Luis Fernandez", now)
    ]
    cursor.executemany("""
    INSERT INTO proveedores (nombre, tipo_servicio, cuenta_bancaria, banco, rif, telefono, email, contacto_nombre, fecha_registro)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
    """, proveedores)

    # Obtener IDs de proveedores
    cursor.execute("SELECT id, nombre FROM proveedores;")
    proveedor_map = {row['nombre']: row['id'] for row in cursor.fetchall()}

    # ========== INSERTAR PAGOS CON PROVEEDORES ==========
    pagos = [
        (unit_map['Torre B - 402'], 240.00, "2026-05-15", "REF-983172", "Transferencia Bancaria", "Cuota Mantenimiento Octubre", "Pagado", None, proveedor_map.get('Hidrocapital')),
        (unit_map['Torre B - 402'], 240.00, "2026-04-12", "REF-874291", "Tarjeta de Credito", "Cuota Mantenimiento Septiembre", "Pagado", None, proveedor_map.get('Hidrocapital')),
        (unit_map['Torre B - 402'], 240.00, "2026-03-14", "REF-762941", "Transferencia Bancaria", "Cuota Mantenimiento Agosto", "Pagado", None, proveedor_map.get('Hidrocapital')),
        (unit_map['Torre B - 105'], 450.00, "2026-05-15", "REF-000000", "Transferencia Bancaria", "Cuota Mantenimiento Octubre", "Pendiente", None, proveedor_map.get('Hidrocapital')),
        (unit_map['Torre A - 301'], 120.00, "2026-05-20", "REF-472910", "Pago Movil", "Fondo de Reserva", "En Revision", "comprobante_demo.png", None)
    ]
    cursor.executemany("""
    INSERT INTO pagos (unidad_id, monto, fecha, referencia, metodo, concepto, estado, comprobante_url, proveedor_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
    """, pagos)

    # ========== INSERTAR VERIFICACIONES BANCARIAS ==========
    cursor.execute("SELECT id, referencia FROM pagos WHERE referencia LIKE 'REF-983172' OR referencia LIKE 'REF-874291' OR referencia LIKE 'REF-762941';")
    pago_ids = cursor.fetchall()
    
    verificaciones = []
    for p in pago_ids:
        verificaciones.append((p['id'], p['referencia'], 240.00, now, "exitoso", "Pago verificado con el banco", '{"codigo": "00", "mensaje": "Transaccion aprobada"}'))
    
    if verificaciones:
        cursor.executemany("""
        INSERT INTO verificaciones_bancarias (pago_id, referencia, monto, fecha_verificacion, estado, mensaje, respuesta_banco)
        VALUES (?, ?, ?, ?, ?, ?, ?);
        """, verificaciones)

    # ========== INSERTAR EGRESOS CON PROVEEDORES ==========
    egresos = [
        ("Mantenimiento Ascensores Torre B", 2300.00, "2026-05-10", "soporte_ascensor.pdf", proveedor_map.get('Ascensores Modernos')),
        ("Seguridad Fisica 24/7", 1000.00, "2026-05-01", "soporte_seguridad.pdf", proveedor_map.get('Seguridad Total C.A.')),
        ("Limpieza Areas Verdes y Jardines", 1500.00, "2026-05-05", "soporte_jardines.pdf", proveedor_map.get('Limpieza Profesional C.A.'))
    ]
    cursor.executemany("""
    INSERT INTO egresos (concepto, monto, fecha, soporte_pdf, proveedor_id)
    VALUES (?, ?, ?, ?, ?);
    """, egresos)

    # ========== INSERTAR ACCESOS ==========
    accesos = [
        (user_map['residente@condosmart.com'], None, "2026-06-18 11:45:00", "Biometrico", "Autorizado", "Garita 1 Peatonal"),
        (None, "Carlos Mendoza", "2026-06-18 14:20:00", "QR", "Autorizado", "Puerta Principal"),
        (user_map['sofia@condosmart.com'], None, "2026-06-18 18:30:00", "Tag NFC", "Autorizado", "Entrada Vehicular"),
        (None, "Intruso Desconocido", "2026-06-18 23:05:00", "PIN", "Denegado", "Garita 1 Peatonal")
    ]
    cursor.executemany("""
    INSERT INTO accesos (usuario_id, nombre_visitante, fecha_hora, tipo_acceso, estado, puerta)
    VALUES (?, ?, ?, ?, ?, ?);
    """, accesos)

    # ========== INSERTAR CONFIGURACIONES ==========
    configs = [
        ("presion_minima", "30.0", "2026-06-18 19:44:00"),
        ("presion_maxima", "75.0", "2026-06-18 19:44:00"),
        ("tiempo_muestreo", "60", "2026-06-18 19:44:00"),
        ("bomba_norte_estado", "Nominal", "2026-06-18 19:44:00")
    ]
    cursor.executemany("""
    INSERT INTO configuracion_sistema (parametro, valor, fecha_actualizacion)
    VALUES (?, ?, ?);
    """, configs)

    conn.commit()
    print("Demo data seeded successfully.")

if __name__ == "__main__":
    init_db()