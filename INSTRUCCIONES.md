# Cuotas Capulac: puesta en marcha

La app tiene dos tipos de usuario:

| | Administrador | Invitado (vecinos) |
|---|---|---|
| Acceso | Usuario y contraseña | Solo abrir el enlace, sin usuario |
| Registrar pagos, gastos, adeudos y propietarios | ✓ | ✗ |
| Modificar y eliminar | ✓ | ✗ |
| Ver saldo, gastos y estado de cada casa | ✓ | ✓ |
| Ver nombres, teléfonos y notas | ✓ | ✗ |

El usuario y la contraseña se verifican en **tu** hoja de Google. La contraseña se guarda cifrada y no aparece en el código de la app.

## 1. Crear la hoja de Google (una sola vez, ~10 min, desde una computadora)

1. En Google Drive crea una **hoja de cálculo** nueva, por ejemplo "Cuotas Capulac".
2. Ve al menú **Extensiones → Apps Script**. Borra el código que aparece y pega **todo** el contenido de
   `google-apps-script/Codigo.gs`. Guarda con el ícono de disquete.
3. Regresa a la hoja y **recárgala**. Aparece el menú **Cuotas**.
   Elige **Cuotas → Establecer usuario y contraseña del administrador** y escribe el usuario y luego la contraseña.
   La primera vez Google pide permisos: *Revisar permisos → tu cuenta → Configuración avanzada → Ir a (proyecto) → Permitir*.
4. En Apps Script ve a **Implementar → Nueva implementación** y elige el tipo **Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier persona**

   Pulsa **Implementar** y copia la URL que termina en `/exec`.

> Si después cambias el código del script, ve a **Implementar → Gestionar implementaciones → Editar → Versión nueva**.
> Así la URL sigue siendo la misma.

## 2. Conectar la app como administrador

En la app ve a **Ajustes → Conectar con Google Sheets**. Pega la URL `/exec`, escribe tu usuario y contraseña, y pulsa **Conectar e iniciar sesión**.
Si la hoja está vacía, la app ofrece subir los datos que ya tienes en ese dispositivo.

En otros dispositivos del administrador, solo abre la app y pulsa **Iniciar sesión** (arriba a la derecha).

## 3. Dejar la URL fija para los vecinos

Pega la URL `/exec` en `config.js` (`apiUrl: '...'`) y vuelve a publicar la app.
Desde ese momento, cualquiera que abra el enlace entra directamente como **invitado**, con los datos de tu hoja de Google.

## 4. Compartir con los vecinos

En **Ajustes → Compartir enlace** (por WhatsApp, por ejemplo). Los vecinos pueden instalarla: Chrome → menú ⋮ → **Instalar app**.

## Seguridad

- Las sesiones del administrador duran 180 días. Para cerrarlas todas (por ejemplo, si pierdes el teléfono), en la hoja usa **Cuotas → Cerrar todas las sesiones de administrador**.
- Para cambiar el usuario o la contraseña, usa de nuevo **Cuotas → Establecer usuario y contraseña del administrador**.
- Después de 5 intentos fallidos, el inicio de sesión se bloquea 15 minutos.
- No edites a mano las columnas `id`/`casaId` de la hoja.
