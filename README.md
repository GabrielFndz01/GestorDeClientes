# Centro de Soporte · Gestor de Tickets

Aplicación web para gestionar tickets de soporte técnico (clientes, dispositivos, prioridad, diagnóstico), usando **Google Sheets como base de datos** a través de **Google Apps Script** como API.

## Stack

- **Frontend:** HTML, CSS y JavaScript sin frameworks. Chart.js para las analíticas.
- **Backend:** Google Apps Script, publicado como Web App (`doGet` / `doPost`).
- **Base de datos:** Google Sheets.

## Arquitectura

```
index.html / styles.css / app.js  →  fetch()  →  Apps Script Web App  →  Google Sheets
```

El frontend nunca accede a la planilla directamente: todo pasa por el Web App de Apps Script, que expone cuatro acciones vía `doPost`:

| Acción     | Qué hace                                             | Requiere clave admin |
|------------|-------------------------------------------------------|:---:|
| `create`   | Crea un ticket nuevo                                   | No |
| `update`   | Actualiza campos de un ticket existente                | No |
| `backup`   | Guarda una copia completa de los datos actuales         | Sí |
| `restore`  | Reemplaza los datos actuales por el último resguardo    | Sí |

`doGet` devuelve todos los tickets más el estado del resguardo (`lastBackupAt`, `hasUnsavedChanges`).

## Configuración

1. Creá la planilla con una hoja llamada `Registro_Clientes` con estas columnas en la primera fila: `Nr_Cliente`, `Marca temporal`, `Nombre`, `Apellido`, `Localidad`, `Teléfono (WhatsApp)`, `Dispositivo`, `Prioridad`, `Estado`, `Archivado`, `Diagnostico`, `Detalles de la consulta`. `Code.gs` lee los encabezados de forma dinámica, así que si agregás o renombrás columnas no hace falta tocar el backend.
2. Pegá el contenido de `Code.gs` en el editor de Apps Script de esa planilla (Extensiones → Apps Script).
3. Configurá la clave de administrador (una única vez):
   - Editor de Apps Script → ícono de engranaje **Configuración del proyecto**.
   - **Propiedades del script** → **Añadir propiedad del script**.
   - Nombre: `ADMIN_SECRET` — Valor: una clave larga y aleatoria (guardala en un gestor de contraseñas, no en el código).
4. Implementar → Nueva implementación → Aplicación web. Ejecutar como "Yo", acceso "Cualquier usuario".
5. Copiá la URL que te da Apps Script y pegala en `CONFIG.API_URL` dentro de `app.js`.

## Resguardo y restauración de datos

Como la app queda expuesta públicamente, cualquier visitante puede crear o editar tickets. Para que eso no ponga en riesgo los datos reales, el sistema tiene varias capas:

1. **Resguardo manual:** el botón "Resguardar datos" (sidebar, solo visible en escritorio) guarda una copia completa de la planilla en una hoja oculta (`Respaldo`). El botón "Restaurar resguardo" reemplaza los datos actuales por esa copia.
2. **Indicador de estado:** un punto de color en el sidebar muestra si hay cambios sin resguardar desde el último backup (🟠) o si todo está al día (🟢), calculado en el servidor comparando un hash de los datos actuales contra el del último resguardo.
3. **Clave de administrador:** `backup` y `restore` piden una clave que se valida en el servidor (Script Properties), nunca queda escrita en el código público. Sin esa propiedad configurada, ambas acciones quedan deshabilitadas por defecto.
4. **Límite de filas:** `create` deja de aceptar tickets nuevos por encima de `MAX_ROWS` (500 por defecto), para que un script no llene la planilla de basura.
5. **Límite de solicitudes:** un tope simple de escrituras por minuto (compartido entre todos los visitantes) frena scripts que golpeen la API en loop.
6. **Saneamiento de datos:** cualquier valor de texto que empiece con `=`, `+`, `-` o `@` se guarda como texto plano, para evitar inyección de fórmulas en la planilla.
7. **Historial de versiones de Google Sheets:** además de todo lo anterior, Archivo → Historial de versiones en la planilla guarda automáticamente versiones anteriores sin necesidad de código — es una red de seguridad extra, gratis.

### Qué NO resuelve este esquema

- **La clave de administrador no es infalible.** Es un `prompt` de texto validado en el servidor: suficiente para un proyecto de portfolio, pero no equivalente a un login real con OAuth. Si necesitás algo más robusto, la vía correcta es restringir el acceso con cuentas de Google (Apps Script lo soporta con `Session.getActiveUser()` cuando el acceso no es "Cualquier usuario").
- **La lectura (`doGet`) sigue siendo pública.** Cualquiera con la URL puede ver todos los tickets. Si la planilla tiene datos reales de clientes (nombres, teléfonos), **no publiques ese link con datos reales** — usá datos ficticios para la demo, o agregá autenticación antes de exponerlo.

## Estructura de archivos

```
index.html    → estructura de la página
styles.css    → estilos (sistema de variables CSS, tema claro/oscuro)
app.js        → lógica de la aplicación
Code.gs       → backend (Apps Script), se pega en el editor de la planilla
```
