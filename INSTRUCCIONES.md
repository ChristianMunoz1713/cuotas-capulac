# Cuotas Capulac — Puesta en marcha

## 1. Crear la hoja de Google (una sola vez, ~10 min)

1. En Google Drive crea una **Hoja de cálculo** nueva, por ejemplo "Cuotas Capulac".
2. Menú **Extensiones → Apps Script**. Borra el código que aparece y pega **todo** el contenido de
   `google-apps-script/Codigo.gs`. Guarda (ícono de disquete).
3. Regresa a la hoja y **recárgala**. Aparece el menú **Cuotas**.
   Elige **Cuotas → Establecer clave de administrador** y escribe una clave de al menos 8 caracteres.
   La primera vez Google pide permisos: *Revisar permisos → tu cuenta → Configuración avanzada → Ir a (proyecto) → Permitir*.
4. En Apps Script: **Implementar → Nueva implementación**, tipo **Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier persona**
   
   Pulsa **Implementar** y copia la URL que termina en `/exec`.

> Si después cambias el código del script, usa **Implementar → Gestionar implementaciones → Editar → Versión nueva**
> para que la URL siga siendo la misma.

## 2. Publicar la app en internet (gratis)

La app debe estar en una dirección `https` para instalarse en los celulares.

- **Netlify (más fácil):** entra a https://app.netlify.com/drop y arrastra la carpeta `Cuotas Mantenimiento`.
  Te da una dirección tipo `https://nombre.netlify.app`.
- **GitHub Pages:** sube la carpeta a un repositorio y activa *Settings → Pages*.

Opcional: antes de subirla, pega la URL `/exec` en `config.js` (`apiUrl: '...'`).
Así cualquiera que abra la dirección ya entra conectado en modo consulta.

## 3. Conectar al administrador

En la app: **Ajustes → Google Sheets** → pega la URL `/exec` y la clave → **Conectar como administrador**.
Si la hoja está vacía, la app ofrece subir los datos que ya tienes en ese dispositivo (las 62 casas y lo que hayas registrado).

## 4. Compartir con los residentes

En **Ajustes → Enlace para residentes → Compartir enlace** (por WhatsApp, por ejemplo).
Los residentes abren el enlace en Chrome → menú ⋮ → **Instalar app**.

Lo que ven los residentes: el saldo, los gastos, el estado de cada casa por mes y la opción de elegir "Mi casa".
Lo que **no** ven: nombres, teléfonos ni notas de los pagos. No pueden registrar, editar ni borrar nada.

## Notas

- Los datos viven en la hoja de Google (pestañas Config, Casas, Pagos, Gastos, Adeudos). No edites las columnas `id`/`casaId` a mano.
- Si el administrador se queda sin internet, los cambios se guardan en el teléfono y se envían solos al volver la conexión.
- Puede haber más de un administrador: comparte la clave solo con quien deba registrar pagos. Para cambiarla, usa de nuevo
  *Cuotas → Establecer clave de administrador*; quien tenga la clave anterior pasará a modo consulta.
