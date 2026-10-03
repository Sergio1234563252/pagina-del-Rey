
const { useState, useEffect, useMemo, useCallback, useRef, createContext, useContext, useReducer } = React;

/* ============================= UTILIDADES ============================= */
const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MONTHS_ABBR = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const money = (n) => '$' + (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtDate = (d) => {const dt = new Date(d);return isNaN(dt) ? d : dt.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });};
const todayISO = () => new Date().toISOString().slice(0, 10);
const nowTime = () => new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
// Suma N días a una fecha ISO (YYYY-MM-DD) y regresa otra fecha ISO — usado para el vencimiento del personal de prueba.
function sumarDiasISO(fechaISO, dias) {
  const d = new Date(fechaISO + 'T00:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}
// --- Personal de prueba (acceso temporal de 7 días, sección: Personal de prueba) ---
function pruebaVencida(st) {
  if (!st || !st.esPrueba || !st.fechaVencimiento) return false;
  return todayISO() > st.fechaVencimiento;
}
function diasRestantesPrueba(st) {
  if (!st || !st.fechaVencimiento) return 0;
  const hoy = new Date(todayISO() + 'T00:00:00');
  const venc = new Date(st.fechaVencimiento + 'T00:00:00');
  return Math.ceil((venc - hoy) / 86400000);
}
// --- Sabores agotados por el Cantinero (sección: Control de sabores) ---
// Se guardan como claves "catId::sabor" dentro de state.saboresAgotados.
function claveSabor(catId, sabor) {return catId + '::' + sabor;}
function saborEstaAgotado(state, catId, sabor) {return (state.saboresAgotados || []).includes(claveSabor(catId, sabor));}
// --- Mesero / Cliente en tablas de preparación (bartender y cocina) ---
// Distingue si el pedido lo tomó un mesero/bartender para una mesa, o si fue el cliente pidiendo directo desde la app.
function infoMeseroCliente(v) {
  if (v.clienteNombre) {
    return { mesero: 'Pedido directo (app)', cliente: v.clienteNombre };
  }
  return { mesero: v.mesero || '—', cliente: v.mesaNumero ? 'Mesa ' + v.mesaNumero : '—' };
}
// Extrae el número de piezas del nombre de una variante de Alitas (ej. "10 piezas" -> 10), usado para repartir toppings combinados.
function piezasDeVariante(nombreVariante) {
  const m = String(nombreVariante || '').match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}
// Precio por pieza para pedidos de Alitas con "Cantidad personalizada" (cuando el cliente pide una cantidad
// distinta a las presentaciones fijas de 8/10/12, ej. 15 piezas) — $16/pza, consistente con el precio del menú.
const PRECIO_POR_PIEZA_ALITA = 16;
// Regresa la variante "efectiva" a usar en todos los cálculos: si es la opción personalizada, construye una
// variante con el nombre "N piezas" y su precio (N × $16) a partir de lo que escribió el cliente/mesero.
function varianteEfectivaAlitas(variante, piezasPersonalizadas) {
  if (variante && variante.personalizada) {
    const n = Math.max(0, Number(piezasPersonalizadas) || 0);
    return { nombre: n + ' piezas', precio: n * PRECIO_POR_PIEZA_ALITA, personalizada: true };
  }
  return variante;
}
// --- Nómina semanal (sección: cierre semanal del admin) ---
// Regresa {inicio, fin} (ISO) de la semana Lunes–Domingo que contiene hoy.
function rangoSemanaActual() {
  const hoy = new Date();
  const dia = hoy.getDay(); // 0=domingo … 6=sábado
  const lunes = new Date(hoy);lunes.setDate(hoy.getDate() - (dia + 6) % 7);
  const domingo = new Date(lunes);domingo.setDate(lunes.getDate() + 6);
  return { inicio: lunes.toISOString().slice(0, 10), fin: domingo.toISOString().slice(0, 10) };
}
// --- Cuenta abierta (sección: pagar después) ---
// Agrega un ítem a la cuenta abierta vigente de un CLIENTE con cuenta (pedidos desde la app) — crea una nueva si no tiene.
function agregarACuentaAbierta(setState, cliente, item) {
  setState((s) => {
    const existente = (s.cuentasAbiertas || []).find((t) => t.tipo !== 'mesa' && t.clienteEmail === cliente.email && t.estado !== 'cerrada');
    if (existente) {
      return { ...s, cuentasAbiertas: s.cuentasAbiertas.map((t) => t.id !== existente.id ? t : { ...t, items: [...t.items, item], total: t.total + item.total }) };
    }
    const nueva = { id: uid('tab'), tipo: 'cliente', clienteEmail: cliente.email, clienteNombre: cliente.nombre, fechaApertura: todayISO(), items: [item], total: item.total, estado: 'abierta', metodoPagoSolicitado: null, horaSolicitud: null, folio: null, metodoPagoFinal: null, horaCierre: null };
    return { ...s, cuentasAbiertas: [...(s.cuentasAbiertas || []), nueva] };
  });
}
// Agrega un ítem a la cuenta abierta vigente de una MESA (consumo en el local, registrado por Mesero/Cantinero
// para clientes sin cuenta) — se identifica por zona+número, no por cliente, y se acumula igual hasta cobrarla.
function agregarACuentaAbiertaMesa(setState, mesaInfo, meseroNombre, item) {
  setState((s) => {
    const mesaKey = mesaInfo.zona + '-' + mesaInfo.numero;
    const existente = (s.cuentasAbiertas || []).find((t) => t.tipo === 'mesa' && t.mesaKey === mesaKey && t.estado !== 'cerrada');
    if (existente) {
      return { ...s, cuentasAbiertas: s.cuentasAbiertas.map((t) => t.id !== existente.id ? t : { ...t, items: [...t.items, item], total: t.total + item.total }) };
    }
    const nueva = { id: uid('tab'), tipo: 'mesa', mesaKey, mesaNumero: mesaInfo.numero, zona: mesaInfo.zona, abiertaPor: meseroNombre, clienteNombre: 'Mesa ' + mesaInfo.numero + ' (' + mesaInfo.zona + ')', fechaApertura: todayISO(), items: [item], total: item.total, estado: 'abierta', metodoPagoSolicitado: null, horaSolicitud: null, folio: null, metodoPagoFinal: null, horaCierre: null };
    return { ...s, cuentasAbiertas: [...(s.cuentasAbiertas || []), nueva] };
  });
}

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}
// Rotación de meseros: alterna cada semana ISO
// Ambas zonas (Interior y Corredor) están activas TODOS los días, cada una atendida por un mesero distinto.
// La asignación base alterna semanalmente entre los dos meseros titulares (Semana A / Semana B).
function zonasBaseDelDia(date, mesero1Name = 'Mesero 1', mesero2Name = 'Mesero 2') {
  const week = getISOWeek(date);
  const weekIsA = week % 2 === 1; // semana A impar
  return weekIsA ?
  { Corredor: mesero1Name, Interior: mesero2Name } :
  { Corredor: mesero2Name, Interior: mesero1Name };
}
// Asignación EFECTIVA por zona para una fecha: la base automática, editable/reasignable por el Administrador
// para cualquier día (ej. asignar a Sergio afuera y a Karla adentro, o cubrir a alguien que faltó).
function zonasEfectivasDelDia(state, date) {
  const meseros = state.staff.filter((s) => s.rol === 'mesero');
  const m1 = meseros[0]?.nombre,m2 = meseros[1]?.nombre;
  const base = zonasBaseDelDia(date, m1, m2); // {Corredor, Interior}
  const fechaISO = date.toISOString().slice(0, 10);
  const resultado = {};
  ['Interior', 'Corredor'].forEach((zona) => {
    const ov = state.shiftOverrides.find((o) => o.fecha === fechaISO && o.zona === zona);
    resultado[zona] = ov ?
    { mesero: ov.meseroNombre, asignadoPorAdmin: true, meseroBase: base[zona], motivo: ov.motivo } :
    { mesero: base[zona], asignadoPorAdmin: false };
  });
  return resultado;
}
// Zona (y datos) asignada a un mesero específico en una fecha dada, o null si no le toca ninguna zona ese día.
function zonaDeMesero(state, date, meseroNombre) {
  const zonas = zonasEfectivasDelDia(state, date);
  for (const zona of ['Interior', 'Corredor']) {
    if (zonas[zona].mesero === meseroNombre) return { zona, ...zonas[zona] };
  }
  return null;
}
function cuponDelMes(date = new Date()) {
  return 'FAM-' + MONTHS_ABBR[date.getMonth()] + String(date.getFullYear()).slice(-2);
}
// Valida si el cupón familiar está disponible según el horario del negocio al que pertenece la cuenta.
// Boutique: 11:00–19:30 | Imprenta: 11:00–21:50
// Fuera de ese horario el cupón se bloquea y el cliente paga precio normal.
const COUPON_SCHEDULES = {
  'boutique_maia': { apertura: [11, 0], cierre: [19, 30], label: 'Boutique (11:00–19:30)' },
  'imprenta_nacho': { apertura: [11, 0], cierre: [21, 50], label: 'Imprenta (11:00–21:50)' }
};
function cuponEnHorario(emailCliente) {
  const sched = COUPON_SCHEDULES[emailCliente];
  if (!sched) return true; // si no está en la lista de horarios, no restringir
  const ahora = new Date();
  const hh = ahora.getHours(),mm = ahora.getMinutes();
  const [ah, am] = sched.apertura,[ch, cm] = sched.cierre;
  const minActual = hh * 60 + mm;
  const minAbre = ah * 60 + am;
  const minCierra = ch * 60 + cm;
  return minActual >= minAbre && minActual <= minCierra;
}
// Tiempo estimado de preparación de bebidas — visible para Cantinero, Mesero y Cliente. Acepta id de categoría o nombre.
function tiempoPreparacionBebida(cat) {
  const v = (cat || '').toLowerCase();
  if (v === 'micheladas' || v.includes('michelada')) return '5–10 min (puede tardar más si hay pedidos por delante)';
  if (v === 'preparadas' || v === 'elrey' || v.includes('preparada') || v.includes('el rey')) return '~15 min';
  return null; // cervezas, licores, cortitos, sin alcohol: servicio inmediato
}
// Tiempo estimado de preparación por producto de cocina — visible para Cocina, Mesero, Bartender y Cliente.
// Cola de comandas de cocina en ESTRICTO orden de llegada (FIFO): la primera solicitada es la primera en la lista.
// Solo incluye las que aún no se han marcado "Listo" — en cuanto se marca, desaparece de la cola y sube la siguiente.
function comandasEnCola(state) {
  return state.sales.
  filter((s) => (s.categoria === 'Alitas' || s.categoria === 'Snacks y botanas') && s.estadoPedido !== 'Listo' && s.estadoPedido !== 'Entregado' && s.estadoPedido !== 'Cancelado').
  sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora)); // sort estable: empates conservan el orden real de llegada
}
// Número de turno (posición en la cola, empezando en 1) de una venta específica, o null si ya no está en cola.
function turnoDeComanda(state, ventaId) {
  const idx = comandasEnCola(state).findIndex((c) => c.id === ventaId);
  return idx === -1 ? null : idx + 1;
}
// --- Horarios especiales de cierre (sección: Horario de cierre por temporada) ---
// Normaliza una hora "HH:MM" a minutos, sumando 24h cuando son horas de madrugada (00:00–05:59).
// Esto permite comparar correctamente un cierre que cruza la medianoche (ej. 00:15) contra
// un cierre anterior el mismo "turno" (ej. cocina a las 23:00), sin que la madrugada parezca "antes".
function minutosOperativos(horaStr) {
  if (!horaStr) return 0;
  let [h, m] = horaStr.split(':').map(Number);
  if (isNaN(h)) return 0;
  if (h < 6) h += 24; // 00:00–05:59 se trata como continuación del turno nocturno anterior
  return h * 60 + (m || 0);
}
function horaActualOperativa() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0'),mm = String(d.getMinutes()).padStart(2, '0');
  return minutosOperativos(hh + ':' + mm);
}
// true si, con el horario especial ACTIVO, ya pasó la hora de cierre de cocina.
function cocinaCerradaPorHorario(hc) {
  if (!hc || !hc.activo || !hc.cierreCocina) return false;
  return horaActualOperativa() >= minutosOperativos(hc.cierreCocina);
}
// true si, con el horario especial ACTIVO, ya pasó la hora de cierre del establecimiento.
function establecimientoCerradoPorHorario(hc) {
  if (!hc || !hc.activo || !hc.cierreEstablecimiento) return false;
  return horaActualOperativa() >= minutosOperativos(hc.cierreEstablecimiento);
}
// Minutos restantes para que cierre la cocina (puede ser negativo si ya cerró), o null si el horario no está activo.
function minutosParaCierreCocina(hc) {
  if (!hc || !hc.activo || !hc.cierreCocina) return null;
  return minutosOperativos(hc.cierreCocina) - horaActualOperativa();
}
// --- Horario diario de la Cocina (Forma 1: automático por horario / Forma 2: manual por la cocinera) ---
// state.cocinaHorario = {horaApertura, horaCierreAuto} — editable por el admin.
// state.cocinaManual = {estado:'abierta'|'cerrada', fecha, hora, por, motivo} — override de HOY; deja de aplicar al día siguiente.
function horaTexto12(hhmm) {
  if (!hhmm) return '';
  let [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;if (h12 === 0) h12 = 12;
  return h12 + ':' + String(m || 0).padStart(2, '0') + ' ' + ampm;
}
function cocinaHorarioActual(state) {return state.cocinaHorario || { horaApertura: '15:00', horaCierreAuto: '22:15' };}
// true si, según el horario diario (o el override manual de hoy), la cocina está abierta ahora mismo.
function cocinaAbiertaPorHorarioDiario(state) {
  const manual = state.cocinaManual;
  if (manual && manual.fecha === todayISO()) return manual.estado === 'abierta';
  const cfg = cocinaHorarioActual(state);
  const ahora = horaActualOperativa();
  return ahora >= minutosOperativos(cfg.horaApertura) && ahora < minutosOperativos(cfg.horaCierreAuto);
}
// true si la cocina está cerrada por CUALQUIER motivo: horario diario/override manual, o el cierre especial de esta noche (horariosCierre).
function cocinaEfectivamenteAbierta(state) {
  if (establecimientoCerradoPorHorario(state.horariosCierre)) return false;
  if (cocinaCerradaPorHorario(state.horariosCierre)) return false;
  return cocinaAbiertaPorHorarioDiario(state);
}
// Info consolidada del estado de la cocina para mostrar en los paneles (Cocinera/Admin).
function cocinaEstadoInfo(state) {
  const abierta = cocinaAbiertaPorHorarioDiario(state);
  const manual = state.cocinaManual;
  const cfg = cocinaHorarioActual(state);
  if (manual && manual.fecha === todayISO()) {
    return { abierta, hora: manual.hora, automatico: false, por: manual.por, motivo: manual.motivo || null };
  }
  return { abierta, hora: abierta ? cfg.horaApertura : cfg.horaCierreAuto, automatico: true, por: 'Sistema (horario automático)', motivo: null };
}
// Minutos para el cierre automático programado de hoy (null si ya hay un override manual vigente, o si la cocina ya está cerrada).
function minutosParaCierreCocinaAuto(state) {
  const manual = state.cocinaManual;
  if (manual && manual.fecha === todayISO()) return null;
  const cfg = cocinaHorarioActual(state);
  if (!cocinaAbiertaPorHorarioDiario(state)) return null;
  return minutosOperativos(cfg.horaCierreAuto) - horaActualOperativa();
}
// --- Promoción de cumpleaños: ¿el mes del cumpleaños registrado coincide con el mes actual? ---
function esMesDeCumpleanos(cumpleanosStr) {
  if (!cumpleanosStr) return false;
  const mesCliente = Number(String(cumpleanosStr).slice(5, 7)); // formato de <input type="date">: 'YYYY-MM-DD'
  if (!mesCliente) return false;
  return mesCliente === new Date().getMonth() + 1;
}
// --- Tiempos de preparación dinámicos (controlados por la Cocinera, sección "Tiempos de preparación") ---
// Clave de un platillo de cocina: para Alitas distingue 10 vs 15 piezas; para el resto usa el nombre del producto tal cual.
function claveTiempoPrep(categoria, producto, variante) {
  if (categoria === 'Alitas') return 'Alitas ' + piezasDeVariante(variante) + ' piezas';
  return producto;
}
// Minutos base configurados por la Cocinera para un platillo (o para una venta ya registrada). 20 min por defecto si aún no se ha configurado.
function minutosPrepBase(state, categoria, producto, variante) {
  const clave = claveTiempoPrep(categoria, producto, variante);
  const cfg = state.tiemposPreparacion || {};
  return cfg[clave] != null ? cfg[clave] : 20;
}
// Minutos transcurridos desde que se tomó el pedido (asume que fue hoy, uso normal de un turno).
function minutosTranscurridos(venta) {
  const [h, m] = (venta.hora || '0:0').split(':').map(Number);
  const inicio = new Date();inicio.setHours(h || 0, m || 0, 0, 0);
  return Math.max(0, Math.round((new Date() - inicio) / 60000));
}
// Tiempo estimado REAL de una venta de cocina: suma los minutos base de todas las órdenes que están por delante
// en la cola (incluida ella misma), así el cliente/mesero/bartender ven un estimado realista según la demanda actual.
function tiempoEstimadoRealVenta(state, venta) {
  // Si la Cocinera puso un tiempo real a mano para ESTE pedido (porque conoce su carga de trabajo real en
  // este momento — cuántas comandas tiene por delante ese día), ese valor manda sobre el cálculo automático.
  if (venta.tiempoManualMinutos != null) return venta.tiempoManualMinutos;
  const cola = comandasEnCola(state);
  const idx = cola.findIndex((c) => c.id === venta.id);
  if (idx === -1) return minutosPrepBase(state, venta.categoria, venta.producto, venta.variante);
  let acumulado = 0;
  for (let i = 0; i <= idx; i++) {acumulado += minutosPrepBase(state, cola[i].categoria, cola[i].producto, cola[i].variante);}
  return acumulado;
}
// true si el pedido ya lleva más tiempo del estimado sin marcarse "Listo".
function pedidoDemorado(state, venta) {
  if (!comandasEnCola(state).some((c) => c.id === venta.id)) return false;
  return minutosTranscurridos(venta) > tiempoEstimadoRealVenta(state, venta);
}
function tiempoPreparacion(nombreProducto) {
  const n = (nombreProducto || '').toLowerCase();
  if (n.includes('alita')) return '30–35 min';
  if (n.includes('carnes frías') || n.includes('carnes frias')) return '20–30 min';
  if (n.includes('papa') || n.includes('salchipapa')) return '15–25 min';
  return null;
}
function diasParaEvento(fechaEvento) {
  const now = new Date();now.setHours(0, 0, 0, 0);
  const ev = new Date(fechaEvento);ev.setHours(0, 0, 0, 0);
  return Math.round((ev - now) / 86400000);
}
function inRange(dateStr, range, from, to) {
  const d = new Date(dateStr);const now = new Date();
  if (range === 'hoy') return dateStr === todayISO();
  if (range === 'semana') {const wk = 7 * 86400000;return now - d < wk && d <= now;}
  if (range === 'mes') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  if (range === 'custom') {if (!from || !to) return true;return dateStr >= from && dateStr <= to;}
  return true;
}
function download(filename, text) {
  const blob = new Blob([text], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');a.href = url;a.download = filename;a.click();
  URL.revokeObjectURL(url);
}
function toCSV(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  rows.forEach((r) => lines.push(headers.map((h) => JSON.stringify(r[h] ?? '')).join(',')));
  return lines.join('\n');
}
// Folio único por tipo de operación (sección 8.4): FECHA + consecutivo diario.
// PED-20260824-001 / EVT-20260824-001 / RES-20260824-001
function generarFolio(tipo, state) {
  const ymd = todayISO().replaceAll('-', '');
  const n = (state.folioCounters?.[tipo] || 0) + 1;
  return { folio: tipo + '-' + ymd + '-' + String(n).padStart(3, '0'), nextCounters: { ...state.folioCounters, [tipo]: n } };
}
function validarEmail(v) {return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '');}
function validarPassword(v) {return (v || '').length >= 6;} // sección 20: mínimo provisional de 6 caracteres
// Moderación automática simulada de videos de clientes (sin IA real, sin backend):
// aprueba solo si la descripción menciona claramente al negocio o su oferta.
const PALABRAS_PROMO_NEGOCIO = ['el rey', 'elrey', 'michelada', 'micheladas', 'bar', 'cerveza', 'cervezas', 'bebida', 'bebidas',
'alitas', 'botana', 'botanas', 'evento', 'fiesta', 'cantinero', 'mesero', 'trago', 'copas', 'licor', 'coctel', 'cóctel', 'antro', 'local'];
function moderarVideoPromocional(descripcion, nombreArchivo) {
  const texto = ((descripcion || '') + ' ' + (nombreArchivo || '')).toLowerCase();
  return PALABRAS_PROMO_NEGOCIO.some((p) => texto.includes(p));
}
// Denominaciones de billetes y monedas usadas en el contador de efectivo del corte de caja.
const DENOMINACIONES = [500, 200, 100, 50, 20, 10, 5];
// Sabores disponibles para bebidas que aceptan sabor (ej. micheladas) en la cotización de eventos.
const SABORES_EVENTO = ['Tradicional', 'Cubana', 'Sandía', 'Manzana verde', 'Piña', 'Mango', 'Tamarindo', 'Chamoy', 'Fresa', 'Mora', 'Frutos rojos', 'Diablo'];
// Catálogo de bebidas para eventos — administrable por el Administrador (agregar/editar precio/desactivar).
const BEBIDAS_EVENTO_SEED = [
{ id: uid('beb'), nombre: 'Michelada Lager', precio_referencia: 75, acepta_sabor: true, activo: true },
{ id: uid('beb'), nombre: 'Michelada Victoria', precio_referencia: 85, acepta_sabor: true, activo: true },
{ id: uid('beb'), nombre: 'Vampiro', precio_referencia: 90, acepta_sabor: false, activo: true },
{ id: uid('beb'), nombre: 'Paloma', precio_referencia: 80, acepta_sabor: false, activo: true },
{ id: uid('beb'), nombre: 'Piñada', precio_referencia: 85, acepta_sabor: false, activo: true }];

// Checklist de cierre de turno del Bartender: 16 productos clave (cervezas, refrescos, hielo, vasos, etc.) con su mínimo requerido.
const CHECKLIST_INSUMOS_SEED = [
{ id: 'chk-vasos', nombre: 'Vasos', minimo: 40 },
{ id: 'chk-hielo', nombre: 'Hielo (bolsas)', minimo: 15 },
{ id: 'chk-popotes', nombre: 'Popotes', minimo: 50 },
{ id: 'chk-servilletas', nombre: 'Servilletas', minimo: 40 },
{ id: 'chk-tecate', nombre: 'Cerveza Tecate azul', minimo: 24 },
{ id: 'chk-victoria', nombre: 'Cerveza Victoria', minimo: 24 },
{ id: 'chk-doseq', nombre: 'Cerveza Dos Equis', minimo: 24 },
{ id: 'chk-ultra', nombre: 'Cerveza Ultra', minimo: 24 },
{ id: 'chk-indio', nombre: 'Cerveza Indio', minimo: 24 },
{ id: 'chk-refrescocola', nombre: 'Refresco de cola', minimo: 20 },
{ id: 'chk-refrescosabor', nombre: 'Refresco de sabor (manzanita/toronja)', minimo: 20 },
{ id: 'chk-agua', nombre: 'Agua embotellada', minimo: 20 },
{ id: 'chk-sabritas', nombre: 'Sabritas', minimo: 15 },
{ id: 'chk-limones', nombre: 'Limones (kg)', minimo: 8 },
{ id: 'chk-sal', nombre: 'Sal preparada para michelada', minimo: 5 },
{ id: 'chk-salsas', nombre: 'Chile en polvo / Salsa Valentina', minimo: 5 }];

// Genera y descarga el archivo Excel (.xlsx) del corte de caja para el Administrador.
function generarExcelCorteCaja(cut) {
  try {
    const filas = [
    { Concepto: 'Fecha', Valor: cut.fecha },
    { Concepto: 'Hora de cierre', Valor: cut.hora },
    { Concepto: 'Fondo inicial', Valor: cut.fondoInicial },
    { Concepto: 'Ventas en efectivo', Valor: cut.ventasEfectivo },
    { Concepto: 'Ventas por transferencia', Valor: cut.ventasTransferencia },
    { Concepto: 'Gastos tomados del fondo', Valor: cut.gastoDelFondo },
    { Concepto: 'Descuentos por cupón familiar', Valor: cut.descuentosCuponHoy || 0 },
    { Concepto: 'Efectivo esperado', Valor: cut.efectivoEsperado },
    { Concepto: 'Efectivo contado (billetes)', Valor: cut.efectivoContado },
    { Concepto: 'Diferencia', Valor: cut.diferencia }];

    const filasBilletes = (cut.denominaciones ? Object.entries(cut.denominaciones) : []).map(([denom, cant]) => ({
      Denominación: '$' + denom, Cantidad: cant, Subtotal: Number(denom) * cant
    }));
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(filas);
    XLSX.utils.book_append_sheet(wb, ws1, 'Resumen');
    if (filasBilletes.length) {
      const ws2 = XLSX.utils.json_to_sheet(filasBilletes);
      XLSX.utils.book_append_sheet(wb, ws2, 'Billetes contados');
    }
    XLSX.writeFile(wb, 'corte_caja_' + cut.fecha + '.xlsx');
  } catch (e) {alert('No se pudo generar el Excel (¿la librería XLSX cargó correctamente?): ' + e.message);}
}
// Genera y descarga el PDF del corte de caja (consulta de solo lectura — el corte original nunca se modifica).
function generarPDFCorteCaja(cut) {
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: [320, 620] });
    let y = 30;
    doc.setFont('helvetica', 'bold');doc.setFontSize(16);doc.text('👑 EL REY', 160, y, { align: 'center' });y += 18;
    doc.setFontSize(9);doc.setFont('helvetica', 'normal');doc.text('Corte de caja — documento de consulta', 160, y, { align: 'center' });y += 16;
    doc.setDrawColor(180);doc.line(20, y, 300, y);y += 16;
    doc.setFont('helvetica', 'bold');doc.text('Fecha: ' + cut.fecha + '   Hora: ' + cut.hora, 20, y);y += 14;
    doc.setFont('helvetica', 'normal');
    doc.text('Responsable (bartender): ' + (cut.bartenderNombre || '—'), 20, y);y += 14;
    y += 6;doc.line(20, y, 300, y);y += 16;
    const filas = [
    ['Fondo inicial', money(cut.fondoInicial)],
    ['Ventas en efectivo', money(cut.ventasEfectivo)],
    ['Ventas por transferencia', money(cut.ventasTransferencia)],
    ['Gastos tomados del fondo', '-' + money(cut.gastoDelFondo)],
    ['Descuentos cupón familiar', money(cut.descuentosCuponHoy || 0)],
    ['Efectivo esperado', money(cut.efectivoEsperado)],
    ['Efectivo contado', money(cut.efectivoContado)],
    ['Diferencia', money(cut.diferencia)]];

    filas.forEach(([a, b]) => {doc.text(a, 20, y);doc.text(b, 280, y, { align: 'right' });y += 14;});
    if (cut.notaJustificacion) {y += 6;doc.line(20, y, 300, y);y += 16;doc.setFont('helvetica', 'bold');doc.text('Nota de justificación:', 20, y);y += 14;doc.setFont('helvetica', 'normal');
      doc.splitTextToSize(cut.notaJustificacion, 260).forEach((l) => {doc.text(l, 20, y);y += 12;});
    }
    if (cut.notasCorreccion && cut.notasCorreccion.length) {y += 6;doc.line(20, y, 300, y);y += 16;doc.setFont('helvetica', 'bold');doc.text('Notas de corrección (Admin):', 20, y);y += 14;doc.setFont('helvetica', 'normal');
      cut.notasCorreccion.forEach((n) => {doc.splitTextToSize('• (' + n.fecha + ' ' + n.hora + ') ' + n.texto, 260).forEach((l) => {doc.text(l, 20, y);y += 12;});});
    }
    doc.save('corte_caja_' + cut.fecha + '.pdf');
  } catch (e) {alert('No se pudo generar el PDF: ' + e.message);}
}
function generarTicketPDF(ticket) {
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: [320, 560] });
    let y = 30;
    doc.setFont('helvetica', 'bold');doc.setFontSize(16);doc.text('👑 EL REY', 160, y, { align: 'center' });y += 18;
    doc.setFontSize(9);doc.setFont('helvetica', 'normal');doc.text('Bar de micheladas y bebidas', 160, y, { align: 'center' });y += 8;
    doc.text('— Ticket digital (prototipo, sin valor fiscal) —', 160, y, { align: 'center' });y += 16;
    doc.setDrawColor(180);doc.line(20, y, 300, y);y += 16;
    doc.setFont('helvetica', 'bold');doc.text('Folio: ' + ticket.folio, 20, y);y += 14;
    doc.setFont('helvetica', 'normal');
    doc.text('Fecha: ' + ticket.fecha + ' ' + ticket.hora, 20, y);y += 14;
    doc.text('Cliente: ' + (ticket.clienteNombre || 'Mostrador'), 20, y);y += 14;
    doc.text('Correo: ' + (ticket.clienteEmail || '—'), 20, y);y += 14;
    doc.text('Tipo de pedido: ' + ticket.tipoPedido, 20, y);y += 14;
    if (ticket.empleado) {doc.text('Atendió: ' + ticket.empleado, 20, y);y += 14;}
    y += 6;doc.line(20, y, 300, y);y += 16;
    doc.setFont('helvetica', 'bold');doc.text('Productos / servicios', 20, y);y += 14;doc.setFont('helvetica', 'normal');
    (ticket.items || []).forEach((it) => {
      doc.text((it.cantidad || 1) + 'x ' + it.nombre, 20, y);
      doc.text(money(it.total), 280, y, { align: 'right' });
      y += 14;
    });
    y += 6;doc.line(20, y, 300, y);y += 16;
    doc.text('Subtotal', 20, y);doc.text(money(ticket.subtotal), 280, y, { align: 'right' });y += 14;
    if (ticket.descuento) {doc.text('Descuento/cupón', 20, y);doc.text('-' + money(ticket.descuento), 280, y, { align: 'right' });y += 14;}
    doc.setFont('helvetica', 'bold');doc.setFontSize(12);
    doc.text('TOTAL', 20, y);doc.text(money(ticket.total), 280, y, { align: 'right' });y += 18;
    doc.setFontSize(9);doc.setFont('helvetica', 'normal');
    doc.text('Método de pago: ' + ticket.metodoPago, 20, y);y += 14;
    if (ticket.metodoPago === 'Efectivo') {doc.text('Pago recibido: ' + money(ticket.pagoRecibido || ticket.total), 20, y);y += 14;doc.text('Cambio: ' + money(ticket.cambio || 0), 20, y);y += 14;}
    if (ticket.metodoPago === 'Transferencia') {doc.text('Estado de pago: ' + ticket.estadoPago, 20, y);y += 14;}
    doc.text('Estado del pedido: ' + ticket.estadoPedido, 20, y);y += 16;
    doc.line(20, y, 300, y);y += 16;
    doc.setFontSize(8);doc.text('Gracias por tu compra — El Rey', 160, y, { align: 'center' });
    doc.save(ticket.folio + '.pdf');
  } catch (e) {alert('No se pudo generar el PDF (¿jsPDF cargó correctamente?): ' + e.message);}
}

/* ============================= DATOS SEED ============================= */
const CATALOG_SEED = [
{ id: 'micheladas', nombre: 'Micheladas', tipo: 'bebida', sabores: ['Tradicional', 'Cubana', 'Sandía', 'Manzana verde', 'Piña', 'Mango', 'Tamarindo', 'Chamoy', 'Fresa', 'Mora', 'Frutos rojos', 'Diablo'], cervezas: ['Tecate', 'Dos Equis', 'Ultra', 'Indio'], productos: [
  { id: uid('p'), nombre: 'Michelada de Victoria', variantes: [{ nombre: 'Único', precio: 85 }] },
  { id: uid('p'), nombre: 'Michelada (elige cerveza: Tecate, Dos Equis, Ultra o Indio)', variantes: [{ nombre: 'Único', precio: 75 }], requiereCerveza: true },
  { id: uid('p'), nombre: 'Michelada de medio (elige cerveza)', variantes: [{ nombre: 'Único', precio: 45 }], requiereCerveza: true },
  { id: uid('p'), nombre: 'Cubetazo', variantes: [{ nombre: 'Único', precio: 150 }] }]
},
{ id: 'preparadas', nombre: 'Bebidas preparadas', tipo: 'bebida', sabores: [], conAlcoholToggle: true, productos: [
  { id: uid('p'), nombre: 'Media de seda', variantes: [{ nombre: 'Completo', precio: 100 }, { nombre: 'Medio', precio: 50 }] },
  { id: uid('p'), nombre: 'Piña colada', variantes: [{ nombre: 'Completo', precio: 100 }, { nombre: 'Medio', precio: 50 }] },
  { id: uid('p'), nombre: 'Fresa colada', variantes: [{ nombre: 'Completo', precio: 100 }, { nombre: 'Medio', precio: 50 }] },
  { id: uid('p'), nombre: 'Azulito', variantes: [{ nombre: 'Completo', precio: 80 }, { nombre: 'Medio', precio: 45 }] },
  { id: uid('p'), nombre: 'Rosadito', variantes: [{ nombre: 'Completo', precio: 80 }, { nombre: 'Medio', precio: 45 }] },
  { id: uid('p'), nombre: 'Mojito natural', variantes: [{ nombre: 'Completo', precio: 90 }, { nombre: 'Medio', precio: 45 }] },
  { id: uid('p'), nombre: 'Mojito frutos rojos', variantes: [{ nombre: 'Completo', precio: 90 }, { nombre: 'Medio', precio: 45 }] }]
},
{ id: 'elrey', nombre: 'El Rey (especial)', tipo: 'bebida', sabores: [], productos: [
  { id: uid('p'), nombre: 'Tradicional "El Rey"', variantes: [{ nombre: 'Único', precio: 90 }] }]
},
{ id: 'cervezas', nombre: 'Cervezas individuales', tipo: 'bebida', sabores: [], productos: [
  { id: uid('p'), nombre: 'Tecate azul', variantes: [{ nombre: 'Único', precio: 16 }] },
  { id: uid('p'), nombre: 'Victoria', variantes: [{ nombre: 'Único', precio: 18 }] },
  { id: uid('p'), nombre: 'Indio', variantes: [{ nombre: 'Único', precio: 16 }] },
  { id: uid('p'), nombre: 'Lager', variantes: [{ nombre: 'Único', precio: 16 }] },
  { id: uid('p'), nombre: 'Ultra', variantes: [{ nombre: 'Único', precio: 16 }] }]
},
{ id: 'licores', nombre: 'Licores / Copas', tipo: 'licor', soloLocal: true, productos: [
  { id: uid('p'), nombre: 'Etiqueta Roja', variantes: [{ nombre: '1 L', precio: 100 }, { nombre: '1/2', precio: 50 }] },
  { id: uid('p'), nombre: 'Etiqueta Negra', variantes: [{ nombre: '1 L', precio: 140 }, { nombre: '1/2', precio: 90 }] },
  { id: uid('p'), nombre: "Buchanan's", variantes: [{ nombre: '1 L', precio: 140 }, { nombre: '1/2', precio: 90 }] },
  { id: uid('p'), nombre: 'Black and White', variantes: [{ nombre: '1 L', precio: 100 }, { nombre: '1/2', precio: 50 }] },
  { id: uid('p'), nombre: 'Torres 10', variantes: [{ nombre: '1 L', precio: 100 }, { nombre: '1/2', precio: 50 }] },
  { id: uid('p'), nombre: 'Torres 5', variantes: [{ nombre: '1 L', precio: 100 }, { nombre: '1/2', precio: 50 }] },
  { id: uid('p'), nombre: 'Ron blanco', variantes: [{ nombre: '1 L', precio: 100 }, { nombre: '1/2', precio: 50 }] }]
},
{ id: 'cortitos', nombre: 'Cortitos', tipo: 'licor', productos: [
  { id: uid('p'), nombre: 'Cacahuate', variantes: [{ nombre: 'Único', precio: 100 }] },
  { id: uid('p'), nombre: 'Guanábana', variantes: [{ nombre: 'Único', precio: 100 }] },
  { id: uid('p'), nombre: 'Jobo', variantes: [{ nombre: 'Único', precio: 100 }] },
  { id: uid('p'), nombre: 'Shot tequila (Cabrito/José Cuervo)', variantes: [{ nombre: 'Único', precio: 30 }] }]
},
{ id: 'sinalcohol', nombre: 'Sin alcohol', tipo: 'bebida', productos: [
  { id: uid('p'), nombre: 'Chiva cola', variantes: [{ nombre: 'Único', precio: 25 }] },
  { id: uid('p'), nombre: 'Agua chica', variantes: [{ nombre: 'Único', precio: 15 }] },
  { id: uid('p'), nombre: 'Agua grande', variantes: [{ nombre: 'Único', precio: 25 }] }]
},
{ id: 'alitas', nombre: 'Alitas', tipo: 'comida', sabores: ['BBQ', 'Búfalo', 'Manzana verde', 'Piña', 'Mango', 'Tamarindo', 'Chamoy', 'Fresa', 'Mora', 'Frutos rojos', 'Diablo', 'Habanero', 'Chile'], productos: [
  { id: uid('p'), nombre: 'Alita por pieza', requiereAlitasCombo: true, variantes: [{ nombre: '1 pz', precio: 16 }] },
  { id: uid('p'), nombre: 'Alitas 8 pz', requiereAlitasCombo: true, variantes: [{ nombre: '8 pz', precio: 130 }] },
  { id: uid('p'), nombre: 'Alitas 10 pz', requiereAlitasCombo: true, variantes: [{ nombre: '10 pz', precio: 160 }] },
  { id: uid('p'), nombre: 'Alitas 12 pz', requiereAlitasCombo: true, variantes: [{ nombre: '12 pz', precio: 192 }] }]
},
{ id: 'botanas', nombre: 'Snacks y botanas', tipo: 'comida', productos: [
  { id: uid('p'), nombre: 'Papas gajo', variantes: [{ nombre: 'Único', precio: 60 }] },
  { id: uid('p'), nombre: 'Papas a la francesa', variantes: [{ nombre: 'Único', precio: 50 }] },
  { id: uid('p'), nombre: 'Salchipapas', variantes: [{ nombre: 'Único', precio: 60 }] },
  { id: uid('p'), nombre: 'Botana carnes frías (chica)', variantes: [{ nombre: 'Chica', precio: 100 }] },
  { id: uid('p'), nombre: 'Botana carnes frías (grande)', variantes: [{ nombre: 'Grande', precio: 150 }] },
  { id: uid('p'), nombre: 'Sabritas', variantes: [{ nombre: 'Único', precio: 0 }], pendiente: true }]
}];

const EMOJI = { micheladas: '🍺', preparadas: '🍹', elrey: '👑', cervezas: '🍻', licores: '🥃', cortitos: '🥃', sinalcohol: '🥤', alitas: '🍗', botanas: '🍟' };

const STAFF_SEED = [
{ id: uid('st'), nombre: 'Daniel', rol: 'admin', telefono: '271-555-0100', email: 'daniel@elrey.mx', direccion: 'Av. Independencia 12, Col. Centro, Carlos A. Carrillo, Ver.', usuario: 'Daniel', password: 'admin123', entrada: '—', salida: '—', salarioSemanal: 0 },
{ id: uid('st'), nombre: 'Sergio', rol: 'mesero', telefono: '271-555-0101', email: 'sergio@elrey.mx', direccion: 'Calle Hidalgo 45, Carlos A. Carrillo, Ver.', cuentaBanco: '', entrada: '14:00', salida: '23:00', mesero1: true, usuario: 'sergio', password: 'Sr143513', salarioSemanal: 1400 },
{ id: uid('st'), nombre: 'Guadalupe', rol: 'mesero', telefono: '271-555-0102', email: 'guadalupe@elrey.mx', direccion: 'Calle Morelos 78, Carlos A. Carrillo, Ver.', cuentaBanco: '', entrada: '14:00', salida: '23:00', mesero1: false, usuario: 'Guadalupe', password: 'Lupe1997*', salarioSemanal: 1400 },
{ id: uid('st'), nombre: 'Bartolo', rol: 'bartender', telefono: '271-555-0103', email: 'bartolo@elrey.mx', direccion: 'Av. Juárez 10, Carlos A. Carrillo, Ver.', entrada: '12:00', salida: '23:00', usuario: 'Bartolo', password: 'Bar2002*', salarioSemanal: 1600 },
{ id: uid('st'), nombre: 'Angeles', rol: 'cocinera', telefono: '271-555-0104', email: 'angeles@elrey.mx', direccion: 'Calle Reforma 23, Carlos A. Carrillo, Ver.', entrada: '14:30', salida: '22:30', usuario: 'Angeles', password: 'Angeles0108*', salarioSemanal: 1500 },
{ id: uid('st'), nombre: 'Neli', rol: 'cocinera', telefono: '271-555-0105', email: 'neli@elrey.mx', direccion: 'Calle Reforma 23, Carlos A. Carrillo, Ver.', entrada: '14:30', salida: '22:30', usuario: 'Neli', password: 'cocina1970', salarioSemanal: 1500 }];

const SUPPLIERS_SEED = [
{ id: uid('sup'), nombre: 'Distribuidora de Cerveza del Golfo', tipo: 'Cerveza' },
{ id: uid('sup'), nombre: 'Pollos San Rafael', tipo: 'Pollo' },
{ id: uid('sup'), nombre: 'Papas y Tubérculos Veracruz', tipo: 'Papas' }];

// Cada campaña ahora lleva su propio "tema visual" asociado (sección 10 y 11):
// colorPrimario/colorSecundario/fondo/botones/tarjetas/texto + modo de activación (auto/manual) + rango de fechas.
const CAMPAIGNS_SEED = [
{ id: uid('cmp'), nombre: 'Temporada de fútbol', activa: true, emoji: '⚽', modo: 'manual', desde: '', hasta: '', colorPrimario: '#2fae4e', colorSecundario: '#ffffff', fondo: '#0f1115', botones: '#2fae4e', tarjetas: '#161a22', texto: '#f1ede4', decoracion: ['⚽', '🏆', '🎉'] },
{ id: uid('cmp'), nombre: 'Día del Padre', activa: false, emoji: '👔', modo: 'manual', desde: '06-15', hasta: '06-16', colorPrimario: '#3a6ea5', colorSecundario: '#c9a24b', fondo: '#10161f', botones: '#3a6ea5', tarjetas: '#171f2b', texto: '#f1ede4', decoracion: ['👔', '🍺'] },
{ id: uid('cmp'), nombre: 'Día de las Madres', activa: false, emoji: '💐', modo: 'manual', desde: '05-10', hasta: '05-11', colorPrimario: '#e05a8a', colorSecundario: '#ffd1dc', fondo: '#1a1016', botones: '#e05a8a', tarjetas: '#22151c', texto: '#f7edf1', decoracion: ['💐', '❤️'] },
{ id: uid('cmp'), nombre: '16 de Septiembre', activa: true, emoji: '🇲🇽', modo: 'auto', desde: '09-14', hasta: '09-17', colorPrimario: '#2fae4e', colorSecundario: '#ff5a5a', fondo: '#101613', botones: '#2fae4e', tarjetas: '#161f18', texto: '#f1ede4', decoracion: ['🇲🇽', '🌵'] },
{ id: uid('cmp'), nombre: '20 de Noviembre', activa: false, emoji: '🎖️', modo: 'auto', desde: '11-19', hasta: '11-21', colorPrimario: '#b5892b', colorSecundario: '#2fae4e', fondo: '#12100b', botones: '#b5892b', tarjetas: '#1b170f', texto: '#f1ede4', decoracion: ['⭐', '🎖️'] },
{ id: uid('cmp'), nombre: 'Día de Muertos', activa: false, emoji: '💀', modo: 'auto', desde: '10-30', hasta: '11-02', colorPrimario: '#ff7a1a', colorSecundario: '#7a3ea3', fondo: '#120a17', botones: '#ff7a1a', tarjetas: '#1c1024', texto: '#f2ecf7', decoracion: ['💀', '🏵️'] },
{ id: uid('cmp'), nombre: 'Navidad', activa: false, emoji: '🎄', modo: 'auto', desde: '12-01', hasta: '12-26', colorPrimario: '#c8262b', colorSecundario: '#2fae4e', fondo: '#0c1410', botones: '#c8262b', tarjetas: '#131f19', texto: '#f1f7f1', decoracion: ['❄️'] },
{ id: uid('cmp'), nombre: 'Año Nuevo', activa: false, emoji: '🎆', modo: 'auto', desde: '12-27', hasta: '01-02', colorPrimario: '#c9a24b', colorSecundario: '#111111', fondo: '#0a0a0a', botones: '#c9a24b', tarjetas: '#161616', texto: '#f5f0e0', decoracion: ['🎆', '✨', '🥂'] },
{ id: uid('cmp'), nombre: 'San Valentín', activa: false, emoji: '❤️', modo: 'auto', desde: '02-10', hasta: '02-15', colorPrimario: '#e0304f', colorSecundario: '#ff9db1', fondo: '#160c10', botones: '#e0304f', tarjetas: '#221319', texto: '#f9edf0', decoracion: ['❤️', '💕', '🌹'] },
{ id: uid('cmp'), nombre: 'Temporada de calor', activa: true, emoji: '☀️', modo: 'manual', desde: '', hasta: '', colorPrimario: '#ffb703', colorSecundario: '#00b7c4', fondo: '#151109', botones: '#ffb703', tarjetas: '#20190f', texto: '#f7f1e6', decoracion: ['☀️', '🍺'] },
{ id: uid('cmp'), nombre: 'Temporada vacacional', activa: false, emoji: '🏖️', modo: 'manual', desde: '', hasta: '', colorPrimario: '#00b7c4', colorSecundario: '#ffb703', fondo: '#0a1416', botones: '#00b7c4', tarjetas: '#0f1e21', texto: '#eefaf9', decoracion: ['🏖️', '🍺'] }];

// Devuelve la lista de emojis de decoración de un tema, sin romper emojis compuestos (ej. banderas).
function emojisDeTema(tema) {
  const d = tema.decoracion || tema.emoji || '✨';
  return Array.isArray(d) ? d : Array.from(d).filter((c) => c.trim());
}
const TRANSFER_ACCOUNT_SEED = { titular: 'El Rey Bar S.A. de C.V.', banco: 'BBVA', clabe: '012345678901234567', cuenta: '0123456789', tarjeta: '' };
const INSUMOS_SEED = [
{ id: uid('ins'), nombre: 'Vasos', area: 'cantinero', stock: 120, minimo: 40 },
{ id: uid('ins'), nombre: 'Hielo (bolsas)', area: 'cantinero', stock: 18, minimo: 15 },
{ id: uid('ins'), nombre: 'Popotes', area: 'cantinero', stock: 200, minimo: 50 },
{ id: uid('ins'), nombre: 'Servilletas', area: 'cocina', stock: 35, minimo: 40 },
{ id: uid('ins'), nombre: 'Pollo (kg)', area: 'cocina', stock: 22, minimo: 10 },
{ id: uid('ins'), nombre: 'Papa (kg)', area: 'cocina', stock: 8, minimo: 12 },
{ id: uid('ins'), nombre: 'Aceite (L)', area: 'cocina', stock: 14, minimo: 6 }];

const TABLES_SEED = [
...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ id: 'int-' + n, zona: 'Interior', numero: n, estado: 'libre' })),
...[1, 2, 3, 4].map((n) => ({ id: 'cor-' + n, zona: 'Corredor', numero: n, estado: 'libre' }))];

const EXPENSE_CATEGORIES = ['Cantinero', 'Cocina', 'Administrador'];

// Cuentas de clientes "familiares" con acceso al cupón familiar del 10% (sección: Cupón familiar restringido).
const FAMILY_CUSTOMERS_SEED = [
{ id: uid('cus'), nombre: 'Boutique Maia', email: 'boutique_maia', password: '160826', creado: todayISO() },
{ id: uid('cus'), nombre: 'Imprenta Nacho', email: 'imprenta_nacho', password: '200826', creado: todayISO() }];

const SEED_STATE = {
  theme: 'dark', role: 'cliente', currentStaffId: null, staffSession: null,
  catalog: CATALOG_SEED, combos: [], campaigns: CAMPAIGNS_SEED, activeThemeId: null, previewThemeId: null,
  familiares: ['boutique_maia', 'imprenta_nacho'], // identificadores de cuentas con acceso al cupón familiar
  sales: [], expenses: [], suppliers: SUPPLIERS_SEED, supplierPayments: [],
  staff: STAFF_SEED, attendanceNotices: [], shiftChanges: [], substitutions: [],
  shiftOverrides: [], // sustituciones de zona/día registradas por el Administrador (ej. cubrir a un mesero ausente)
  evaluations: [], eventRequests: [], reservations: [],
  bebidasEvento: BEBIDAS_EVENTO_SEED,
  tables: TABLES_SEED, notifications: [], auditLog: [], tips: [], cashCuts: [], saboresAgotados: [],
  insumos: INSUMOS_SEED, lastExport: null,
  cancelPolicy: [{ diasAntes: 7, reembolso: 100 }, { diasAntes: 3, reembolso: 50 }, { diasAntes: 0, reembolso: 0 }],
  // --- Cuentas de cliente (sección 4.3) ---
  customers: FAMILY_CUSTOMERS_SEED, currentCustomerId: null,
  // --- Folios y tickets digitales (secciones 8.4 y 9) ---
  folioCounters: { PED: 0, EVT: 0, RES: 0 },
  tickets: [], // ticket digital-comprobante unificado (ventas/pedidos/eventos/reservaciones/renta)
  transferAccount: TRANSFER_ACCOUNT_SEED,
  // --- Imágenes de producto subidas por el Cantinero (sección 21), compartidas entre roles ---
  productImages: [], menuFisico: { url: null, fecha: null }, cuentasAbiertas: [], nominaPagos: [],
  negocioAbierto: true, negocioUltimoCambio: null,
  limiteDiferenciaCorte: 200, corteCajaResponsableHoy: null,
  // --- Videos promocionales subidos por clientes, con moderación automática simulada ---
  customerVideos: [],
  // --- Conectores (sección "Sistema"): estado simulado de integraciones externas ---
  connectorsStatus: {},
  // --- Fondo de caja: montos que el Administrador le deja al Bartender para operar la barra ---
  cashFunds: [],
  // --- Sanciones por bloquear mesas indebidamente (aplicadas por el Bartender) ---
  tableSanciones: [],
  // --- Cubetazos: control de cervezas entregadas por mesa, cobradas siempre como paquete ---
  cubetazos: [],
  // --- Cierres de turno del Bartender (checklist de insumos/productos + reportes de reposición) ---
  shiftCloseReports: [],
  // --- Promoción de bebida de cortesía (activable/desactivable por el Admin, no ligada a ninguna temporada) ---
  // modo 'mismo' = la cortesía es la misma bebida que el cliente acaba de comprar; 'fija' = una bebida predefinida (bebidaFijaId).
  cortesiaPromo: { activa: false, modo: 'mismo', bebidaFijaId: '' },
  // Registro de bebidas de cortesía generadas (por promoción de temporada o por cumpleaños) — las ve el Cantinero.
  cortesias: [],
  // --- Promoción de cumpleaños (activada manualmente por el Admin, normalmente al inicio del mes) ---
  cumpleanosPromo: { activa: false, beneficioTipo: 'bebida', bebidaId: '', descuentoPct: 15, nota: '' },
  // --- Horario especial de cierre de cocina/establecimiento (activable solo en temporadas específicas) ---
  horariosCierre: { activo: false, cierreCocina: '23:00', cierreEstablecimiento: '00:15' },
  cocinaHorario: { horaApertura: '15:00', horaCierreAuto: '22:15' }, cocinaManual: null, cocinaUltimoAvisoAuto: null,
  tiemposPreparacion: {
    'Alitas 1 piezas': 15, 'Alitas 8 piezas': 15, 'Alitas 10 piezas': 20, 'Alitas 12 piezas': 25,
    'Botana carnes frías (chica)': 10, 'Botana carnes frías (grande)': 15,
    'Papas gajo': 12, 'Papas a la francesa': 12, 'Salchipapas': 15
  }
};

/* ============================= STORE ============================= */
// Mapea el rol de personal (staff.rol) a la vista/ruta interna del prototipo.
const STAFF_ROLE_ROUTE = { admin: 'admin', bartender: 'bartender', cocinera: 'cocina', mesero: 'mesero' };
const StoreCtx = createContext(null);
// --- Cancelación de pedidos con motivo (Bartender y Mesero) ---
const MOTIVOS_CANCELACION = ['Cliente se fue', 'Error en el pedido', 'Producto agotado', 'Cliente cambió de opinión', 'Otro'];
function ModalCancelarPedido({ venta, quien, onCerrar }) {
  const { updateItem, notify, log, toast } = useStore();
  const [motivo, setMotivo] = useState('');
  const [motivoOtro, setMotivoOtro] = useState('');
  if (!venta) return null;
  function confirmar() {
    const motivoFinal = motivo === 'Otro' ? motivoOtro.trim() : motivo;
    if (!motivoFinal) {toast('Selecciona o escribe el motivo de cancelación');return;}
    updateItem('sales', venta.id, { estadoPedido: 'Cancelado', motivoCancelacion: motivoFinal, canceladoPor: quien, horaCancelacion: nowTime(), fechaCancelacion: todayISO() });
    log(quien, 'Canceló pedido: ' + venta.producto + ' (' + money(venta.total) + ') — motivo: ' + motivoFinal);
    notify({ tipo: 'pedido_cancelado', producto: venta.producto, total: venta.total, motivo: motivoFinal, canceladoPor: quien, atendido: false });
    toast('❌ Pedido cancelado — ' + motivoFinal);
    setMotivo('');setMotivoOtro('');
    onCerrar();
  }
  return /*#__PURE__*/React.createElement("div", { className: "modal-bg", onClick: onCerrar }, /*#__PURE__*/
  React.createElement("div", { className: "modal", onClick: (e) => e.stopPropagation() }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Cancelar pedido"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, venta.producto, venta.variante ? ' (' + venta.variante + ')' : '', " \xB7 ", venta.cantidad, "x \xB7 ", money(venta.total), venta.mesaNumero ? ' · Mesa ' + venta.mesaNumero : ''), /*#__PURE__*/
  React.createElement(Field, { label: "Motivo de cancelaci\xF3n" }, /*#__PURE__*/
  React.createElement("select", { value: motivo, onChange: (e) => setMotivo(e.target.value) }, /*#__PURE__*/
  React.createElement("option", { value: "" }, "Selecciona\u2026"),
  MOTIVOS_CANCELACION.map((m) => /*#__PURE__*/React.createElement("option", { key: m, value: m }, m))
  )
  ),
  motivo === 'Otro' && /*#__PURE__*/React.createElement(Field, { label: "Especifica el motivo" }, /*#__PURE__*/React.createElement("input", { value: motivoOtro, onChange: (e) => setMotivoOtro(e.target.value), placeholder: "Escribe el motivo\u2026" })), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { gap: 8, marginTop: 14 } }, /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary btn-sm", onClick: confirmar }, "\u2705 Confirmar cancelaci\xF3n"), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: onCerrar }, "Volver")
  )
  )
  );
}
// --- Edición de pedidos activos (compartida entre Mesero y Cantinero) ---
// Máximo 2 ediciones por pedido; solo mientras estadoPedido==='Pedido recibido'; el precio, la mesa/cliente y
// la fecha/hora original nunca se tocan. Cada edición queda en historialEdiciones y marca ultimaEdicionPor para
// resaltar la tarjeta del otro rol ("Pedido modificado por…") hasta que el pedido avance de estado.
const MAX_EDICIONES_PEDIDO = 2;
function ModalEditarPedido({ venta, quien, onCerrar }) {
  const { state, updateItem, notify, log, toast } = useStore();
  const cat = venta ? state.catalog.find((c) => c.nombre === venta.categoria) : null;
  const [productoNombre, setProductoNombre] = useState(venta ? venta.producto : '');
  const [cerveza, setCerveza] = useState(venta ? venta.cerveza || '' : '');
  const [sabor, setSabor] = useState(venta ? venta.sabor || '' : '');
  const [notas, setNotas] = useState(venta ? venta.notas || '' : '');
  useEffect(() => {if (venta) {setProductoNombre(venta.producto);setCerveza(venta.cerveza || '');setSabor(venta.sabor || '');setNotas(venta.notas || '');}}, [venta && venta.id]);
  if (!venta) return null;
  const quienLabel = quien === 'mesero' ? 'Mesero' : 'Cantinero';
  const otroLabel = quien === 'mesero' ? 'bartender' : 'mesero';

  function confirmar() {
    const cambios = [];
    if (productoNombre !== venta.producto) cambios.push('Producto: "' + venta.producto + '" → "' + productoNombre + '"');
    if ((cerveza || '') !== (venta.cerveza || '')) cambios.push('Cerveza: "' + (venta.cerveza || '—') + '" → "' + (cerveza || '—') + '"');
    if ((sabor || '') !== (venta.sabor || '')) cambios.push('Sabor: "' + (venta.sabor || '—') + '" → "' + (sabor || '—') + '"');
    if ((notas || '') !== (venta.notas || '')) cambios.push('Notas: "' + (venta.notas || '—') + '" → "' + (notas || '—') + '"');
    if (cambios.length === 0) {toast('No hiciste ningún cambio');return;}
    const nuevoConteo = (venta.edicionesCount || 0) + 1;
    updateItem('sales', venta.id, {
      producto: productoNombre, cerveza: cerveza || null, sabor: sabor || null, notas: notas || '',
      edicionesCount: nuevoConteo, ultimaEdicionPor: quien, ultimaEdicionHora: nowTime(),
      historialEdiciones: [...(venta.historialEdiciones || []), { hora: nowTime(), fecha: todayISO(), editadoPor: quienLabel, cambios: cambios.join(' · ') }]
    });
    log(quienLabel, 'Editó pedido "' + venta.producto + '": ' + cambios.join(' · '));
    notify({ tipo: 'pedido_editado', producto: productoNombre, editadoPor: quienLabel, ventaId: venta.id, cambios: cambios.join(' · '), atendido: false });
    toast('✏️ Pedido actualizado — se avisará al ' + otroLabel + ' (' + nuevoConteo + '/' + MAX_EDICIONES_PEDIDO + ' ediciones)');
    onCerrar();
  }
  return /*#__PURE__*/React.createElement("div", { className: "modal-bg", onClick: onCerrar }, /*#__PURE__*/
  React.createElement("div", { className: "modal", onClick: (e) => e.stopPropagation() }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Editar pedido"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Precio fijo: ", /*#__PURE__*/React.createElement("strong", null, money(venta.total)), " \xB7 ", venta.mesaNumero ? 'Mesa ' + venta.mesaNumero : infoMeseroCliente(venta).cliente, " \xB7 Pedido original: ", venta.fecha, " ", venta.hora, ". El precio, la mesa/cliente y la hora original no se pueden cambiar."), /*#__PURE__*/
  React.createElement(Field, { label: "Producto / bebida" }, /*#__PURE__*/
  React.createElement("select", { value: productoNombre, onChange: (e) => setProductoNombre(e.target.value) },
  (cat ? cat.productos : [{ nombre: venta.producto }]).map((p) => /*#__PURE__*/React.createElement("option", { key: p.nombre, value: p.nombre }, p.nombre))
  )
  ),
  cat && cat.cervezas && cat.cervezas.length > 0 && /*#__PURE__*/React.createElement(Field, { label: "Tipo de cerveza" }, /*#__PURE__*/
  React.createElement("select", { value: cerveza, onChange: (e) => setCerveza(e.target.value) }, /*#__PURE__*/
  React.createElement("option", { value: "" }, "Sin especificar"),
  cat.cervezas.map((c) => /*#__PURE__*/React.createElement("option", { key: c, value: c }, c))
  )
  ),
  cat && cat.sabores && cat.sabores.length > 0 && /*#__PURE__*/React.createElement(Field, { label: "Sabor / variante" }, /*#__PURE__*/
  React.createElement("select", { value: sabor, onChange: (e) => setSabor(e.target.value) }, /*#__PURE__*/
  React.createElement("option", { value: "" }, "Sin especificar"),
  cat.sabores.map((s) => {const agotado = saborEstaAgotado(state, cat.id, s);return /*#__PURE__*/React.createElement("option", { key: s, value: s, disabled: agotado }, agotado ? '🚫 ' + s + ' (agotado)' : s);})
  )
  ), /*#__PURE__*/
  React.createElement(Field, { label: "Notas del pedido" }, /*#__PURE__*/React.createElement("input", { value: notas, onChange: (e) => setNotas(e.target.value), placeholder: "Ej. sin hielo, extra picante\u2026" })), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { gap: 8, marginTop: 14 } }, /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary btn-sm", onClick: confirmar }, "\u2705 Guardar cambios"), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: onCerrar }, "Volver")
  )
  )
  );
}
// Botón + indicadores de edición para una fila/tarjeta de pedido (usado por Mesero y Cantinero).
function AccionesEdicionPedido({ venta, quien, onEditar }) {
  const editable = venta.estadoPedido === 'Pedido recibido';
  const edicionesCount = venta.edicionesCount || 0;
  const limite = edicionesCount >= MAX_EDICIONES_PEDIDO;
  if (!editable) return edicionesCount > 0 ? /*#__PURE__*/React.createElement("span", { className: "small" }, "\u270F\uFE0F Editado ", edicionesCount, "/", MAX_EDICIONES_PEDIDO) : null;
  if (limite) return /*#__PURE__*/React.createElement("span", { className: "small", style: { color: 'var(--danger)' } }, "L\xEDmite de ediciones alcanzado \u2014 solicita un pedido nuevo");
  return /*#__PURE__*/React.createElement("span", { className: "flexrow", style: { gap: 6, flexWrap: 'wrap' } },
  edicionesCount > 0 && /*#__PURE__*/React.createElement("span", { className: "small" }, "\u270F\uFE0F Editado ", edicionesCount, "/", MAX_EDICIONES_PEDIDO), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => onEditar(venta) }, "\u270F\uFE0F Editar pedido")
  );
}
// Aviso de "modificado por el otro rol" — visible mientras el pedido siga en "Pedido recibido".
function AvisoPedidoModificado({ venta, quien }) {
  if (!venta.ultimaEdicionPor || venta.ultimaEdicionPor === quien || venta.estadoPedido !== 'Pedido recibido') return null;
  const otro = venta.ultimaEdicionPor === 'mesero' ? 'el mesero' : 'el bartender';
  return /*#__PURE__*/React.createElement("div", { className: "small", style: { color: 'var(--warn)', fontWeight: 700, marginTop: 4 } }, "\u26A0\uFE0F Pedido modificado por ", otro, " \u2014 revisa antes de preparar");
}
// Barra de progreso visual del tiempo de un pedido de cocina (Mesero y Bartender): minutos transcurridos vs. estimado.
function BarraProgresoCocina({ venta }) {
  const { state } = useStore();
  const [, setTick] = useState(0);
  useEffect(() => {const t = setInterval(() => setTick((x) => x + 1), 30000);return () => clearInterval(t);}, []);
  const estimado = tiempoEstimadoRealVenta(state, venta);
  const transcurrido = minutosTranscurridos(venta);
  const demorado = transcurrido > estimado;
  const pct = Math.min(100, Math.round(transcurrido / estimado * 100));
  return /*#__PURE__*/React.createElement("div", { style: { minWidth: 120 } }, /*#__PURE__*/
  React.createElement("div", { className: "small", style: demorado ? { color: 'var(--danger)', fontWeight: 700 } : {} }, transcurrido, "/", estimado, " min", demorado ? ' ⏰' : ''), /*#__PURE__*/
  React.createElement("div", { style: { height: 6, background: 'var(--bg-soft)', borderRadius: 4, marginTop: 3, overflow: 'hidden' } }, /*#__PURE__*/
  React.createElement("div", { style: { height: '100%', width: pct + '%', background: demorado ? 'var(--danger)' : 'var(--neon)', borderRadius: 4 } })
  )
  );
}
function useStore() {return useContext(StoreCtx);}
// Contexto ligero (solo UI, no se guarda en localStorage) para mostrar/ocultar la barra lateral desde el logo "EL REY".
const SidebarCtx = createContext(null);
function useSidebar() {return useContext(SidebarCtx);}

function StoreProvider({ children }) {
  const [state, setStateRaw] = useState(() => {
    try {
      const raw = localStorage.getItem('elrey_proto_state_v1');
      if (raw) {const parsed = JSON.parse(raw);return { ...SEED_STATE, ...parsed };}
    } catch (e) {}
    return SEED_STATE;
  });
  useEffect(() => {
    try {localStorage.setItem('elrey_proto_state_v1', JSON.stringify(state));} catch (e) {}
  }, [state]);
  useEffect(() => {document.documentElement.setAttribute('data-theme', state.theme);}, [state.theme]);

  // Aplica el tema de temporada activo (manual o automático por fecha) como variables CSS
  // independientes del modo oscuro/claro (sección 10.2). Se aplican sobre #root para no pisar :root base.
  const temaActivo = useMemo(() => {
    const manual = state.campaigns.find((c) => c.id === state.activeThemeId && c.activa);
    if (manual) return manual;
    const mmdd = new Date().toISOString().slice(5, 10);
    return state.campaigns.find((c) => c.activa && c.modo === 'auto' && c.desde && c.hasta && (
    c.desde <= c.hasta ? mmdd >= c.desde && mmdd <= c.hasta : mmdd >= c.desde || mmdd <= c.hasta)
    ) || null;
  }, [state.campaigns, state.activeThemeId]);useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;
    if (temaActivo) {
      root.style.setProperty('--neon', temaActivo.colorPrimario);
      root.style.setProperty('--neon-2', temaActivo.colorSecundario);
      root.style.setProperty('--bg', temaActivo.fondo);
      root.style.setProperty('--panel', temaActivo.tarjetas);
      root.style.setProperty('--ink', temaActivo.texto);
    } else {
      ['--neon', '--neon-2', '--bg', '--panel', '--ink'].forEach((v) => root.style.removeProperty(v));
    }
  }, [temaActivo]);

  const patch = useCallback((p) => setStateRaw((s) => ({ ...s, ...(typeof p === 'function' ? p(s) : p) })), []);
  const pushTo = useCallback((key, obj) => setStateRaw((s) => ({ ...s, [key]: [...(s[key] || []), obj] })), []);
  const updateItem = useCallback((key, id, patchObj) => setStateRaw((s) => ({ ...s, [key]: (s[key] || []).map((it) => it.id === id ? { ...it, ...(typeof patchObj === 'function' ? patchObj(it) : patchObj) } : it) })), []);
  const removeItem = useCallback((key, id) => setStateRaw((s) => ({ ...s, [key]: (s[key] || []).filter((it) => it.id !== id) })), []);
  const log = useCallback((quien, accion) => pushTo('auditLog', { id: uid('log'), quien, accion, fecha: todayISO(), hora: nowTime() }), [pushTo]);
  const notify = useCallback((obj) => pushTo('notifications', { id: uid('ntf'), leida: false, fecha: todayISO(), hora: nowTime(), ...obj }), [pushTo]);
  const [toasts, setToasts] = useState([]);
  const toast = useCallback((msg) => {
    const id = uid('t');setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const allProducts = useMemo(() => state.catalog.flatMap((cat) => cat.productos.map((p) => ({ ...p, categoria: cat.nombre, categoriaId: cat.id, sabores: cat.sabores, cervezas: cat.cervezas, tipo: cat.tipo }))), [state.catalog]);

  // --- Folios y tickets digitales (secciones 8.4 y 9) ---
  const crearFolioYTicket = useCallback((tipo, ticketData) => {
    let folioGenerado = '';
    setStateRaw((s) => {
      const { folio, nextCounters } = generarFolio(tipo, s);
      folioGenerado = folio;
      const ticket = { id: uid('tk'), folio, fecha: todayISO(), hora: nowTime(), estadoPedido: 'Pedido recibido', ...ticketData };
      return { ...s, folioCounters: nextCounters, tickets: [...s.tickets, ticket] };
    });
    return folioGenerado;
  }, []);

  // --- Cuentas de cliente (sección 4.3): registro/login simulados con localStorage ---
  const currentCustomer = useMemo(() => state.customers.find((c) => c.id === state.currentCustomerId) || null, [state.customers, state.currentCustomerId]);
  const registrarCliente = useCallback(({ nombre, email, password, cumpleanos }) => {
    let error = null;
    setStateRaw((s) => {
      if (!nombre || !validarEmail(email)) {error = 'Correo inválido.';return s;}
      if (!validarPassword(password)) {error = 'La contraseña debe tener al menos 6 caracteres.';return s;}
      if (s.customers.some((c) => c.email.toLowerCase() === email.toLowerCase())) {error = 'Ya existe una cuenta con ese correo.';return s;}
      const cliente = { id: uid('cus'), nombre, email, password, cumpleanos: cumpleanos || '', creado: todayISO() };
      return { ...s, customers: [...s.customers, cliente], currentCustomerId: cliente.id };
    });
    return error;
  }, []);
  const iniciarSesionCliente = useCallback(({ email, password }) => {
    let error = null;
    setStateRaw((s) => {
      const found = s.customers.find((c) => c.email.toLowerCase() === (email || '').toLowerCase() && c.password === password);
      if (!found) {error = 'Correo o contraseña incorrectos.';return s;}
      return { ...s, currentCustomerId: found.id };
    });
    return error;
  }, []);
  const cerrarSesionCliente = useCallback(() => setStateRaw((s) => ({ ...s, currentCustomerId: null })), []);
  const recuperarPasswordCliente = useCallback((email) => {
    const found = state.customers.find((c) => c.email.toLowerCase() === (email || '').toLowerCase());
    return found ? true : false; // simulado: no hay envío real de correo
  }, [state.customers]);

  // --- Acceso de personal (Administrador/Cantinero/Cocinera/Mesero): login/registro propio, sin RoleSwitcher ---
  const loginStaff = useCallback(({ usuario, password }) => {
    let error = null;
    setStateRaw((s) => {
      const found = s.staff.find((st) => (st.usuario || '').toLowerCase() === (usuario || '').toLowerCase() && st.password === password);
      if (!found) {error = 'Usuario o contraseña incorrectos.';return s;}
      return { ...s, staffSession: found.id, role: STAFF_ROLE_ROUTE[found.rol] || found.rol };
    });
    return error;
  }, []);
  const registerStaff = useCallback(({ nombre, usuario, password, rol, telefono }) => {
    let error = null;
    setStateRaw((s) => {
      if (!nombre || !usuario || !password || !rol) {error = 'Completa todos los campos.';return s;}
      if (s.staff.some((st) => (st.usuario || '').toLowerCase() === usuario.toLowerCase())) {error = 'Ese usuario ya existe.';return s;}
      const nuevo = { id: uid('st'), nombre, usuario, password, rol, telefono: telefono || '',
        entrada: rol === 'bartender' ? '12:00' : rol === 'cocinera' ? '14:30' : rol === 'admin' ? '—' : '14:00',
        salida: rol === 'cocinera' ? '22:30' : rol === 'admin' ? '—' : '23:00' };
      return { ...s, staff: [...s.staff, nuevo], staffSession: nuevo.id, role: STAFF_ROLE_ROUTE[nuevo.rol] || nuevo.rol };
    });
    return error;
  }, []);
  const logoutStaff = useCallback(() => setStateRaw((s) => ({ ...s, staffSession: null, role: 'cliente' })), []);

  // --- Bebidas de cortesía (promoción de temporada y/o cumpleaños): registra el regalo para que el Cantinero lo vea ---
  const otorgarCortesia = useCallback((obj) => pushTo('cortesias', { id: uid('cor'), fecha: todayISO(), hora: nowTime(), entregada: false, ...obj }), [pushTo]);

  // --- Login único para todos los roles: detecta automáticamente si es personal o cliente ---
  const iniciarSesionUnico = useCallback(({ usuarioOCorreo, password }) => {
    let resultado = null; // null = credenciales inválidas
    const clave = (usuarioOCorreo || '').trim().toLowerCase();
    setStateRaw((s) => {
      const staffMatch = s.staff.find((st) => (st.usuario || '').toLowerCase() === clave && st.password === password);
      if (staffMatch) {
        if (staffMatch.esPrueba && staffMatch.estadoPrueba === 'activo' && pruebaVencida(staffMatch)) {
          resultado = { tipo: 'prueba_vencida' };
          return { ...s, staff: s.staff.map((st) => st.id === staffMatch.id ? { ...st, estadoPrueba: 'vencido' } : st) };
        }
        if (staffMatch.estadoPrueba === 'rechazado' || staffMatch.estadoPrueba === 'vencido') {
          resultado = { tipo: 'prueba_vencida' };
          return s;
        }
        resultado = { tipo: 'staff', nombre: staffMatch.nombre };
        return { ...s, staffSession: staffMatch.id, role: STAFF_ROLE_ROUTE[staffMatch.rol] || staffMatch.rol };
      }
      const clienteMatch = s.customers.find((c) => c.email.toLowerCase() === clave && c.password === password);
      if (clienteMatch) {
        resultado = { tipo: 'cliente', nombre: clienteMatch.nombre };
        return { ...s, currentCustomerId: clienteMatch.id };
      }
      return s;
    });
    return resultado;
  }, []);

  const value = { state, setState: patch, pushTo, updateItem, removeItem, log, notify, toast, toasts, allProducts,
    crearFolioYTicket, currentCustomer, registrarCliente, iniciarSesionCliente, cerrarSesionCliente, recuperarPasswordCliente, temaActivo, iniciarSesionUnico,
    loginStaff, registerStaff, logoutStaff, otorgarCortesia };
  return /*#__PURE__*/React.createElement(StoreCtx.Provider, { value: value }, children);
}

/* ============================= COMPONENTES COMPARTIDOS ============================= */
function ThemeToggle() {
  const { state, setState } = useStore();
  return /*#__PURE__*/React.createElement("button", { className: "icon-btn", onClick: () => setState({ theme: state.theme === 'dark' ? 'light' : 'dark' }), title: "Modo claro/oscuro" },
  state.theme === 'dark' ? '☀️ Claro' : '🌙 Oscuro'
  );
}

function KpiCard({ label, value, sub, icon, range, onRange }) {
  return /*#__PURE__*/React.createElement("div", { className: "card kpi" }, /*#__PURE__*/
  React.createElement("div", { className: "top" }, /*#__PURE__*/
  React.createElement("span", { className: "label" }, icon, " ", label),
  onRange && /*#__PURE__*/React.createElement("div", { className: "range-pills" },
  ['hoy', 'semana', 'mes'].map((r) => /*#__PURE__*/React.createElement("button", { key: r, className: 'pill ' + (range === r ? 'active' : ''), onClick: () => onRange(r) }, r))
  )
  ), /*#__PURE__*/
  React.createElement("div", { className: "value" }, value),
  sub && /*#__PURE__*/React.createElement("div", { className: "sub" }, sub)
  );
}

function QuickAction({ icon, label, onClick }) {
  return /*#__PURE__*/React.createElement("button", { className: "qa", onClick: onClick }, /*#__PURE__*/React.createElement("span", { className: "qi" }, icon), label);
}

function DataTable({ columns, rows, onView, emptyText = 'Sin registros', rowStyle }) {
  if (!rows.length) return /*#__PURE__*/React.createElement("div", { className: "small", style: { padding: '14px 4px' } }, emptyText);
  return /*#__PURE__*/React.createElement("div", { style: { overflowX: 'auto' } }, /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/
  React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, columns.map((c) => /*#__PURE__*/React.createElement("th", { key: c.key }, c.label)), onView && /*#__PURE__*/React.createElement("th", null))), /*#__PURE__*/
  React.createElement("tbody", null, rows.map((r, i) => /*#__PURE__*/React.createElement("tr", { key: r.id || i, style: rowStyle ? rowStyle(r) : undefined },
  columns.map((c) => /*#__PURE__*/React.createElement("td", { key: c.key }, c.render ? c.render(r) : r[c.key])),
  onView && /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => onView(r) }, "Ver"))
  )))
  ));
}

function AlertCard({ title, desc, tone = 'warn' }) {
  return /*#__PURE__*/React.createElement("div", { className: 'alert ' + (tone === 'danger' ? 'danger' : '') }, /*#__PURE__*/
  React.createElement("span", null, tone === 'danger' ? '🚨' : '⚠️'), /*#__PURE__*/
  React.createElement("div", null, /*#__PURE__*/React.createElement("strong", null, title), /*#__PURE__*/React.createElement("div", { className: "small" }, desc))
  );
}

function BarChart({ data, valueKey = 'value', labelKey = 'label', height = 180, color = 'var(--neon)' }) {
  const max = Math.max(1, ...data.map((d) => d[valueKey]));
  return /*#__PURE__*/React.createElement("div", { style: { display: 'flex', alignItems: 'flex-end', gap: 8, height, padding: '6px 0' } },
  data.map((d, i) => {
    const h = Math.max(4, d[valueKey] / max * (height - 30));
    return /*#__PURE__*/React.createElement("div", { key: i, style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 } }, /*#__PURE__*/
    React.createElement("div", { className: "small", style: { fontWeight: 800 } }, typeof d[valueKey] === 'number' && d[valueKey] > 999 ? money(d[valueKey]) : d[valueKey]), /*#__PURE__*/
    React.createElement("div", { style: { width: '70%', height: h, background: color, borderRadius: '6px 6px 0 0' } }), /*#__PURE__*/
    React.createElement("div", { className: "small", style: { textAlign: 'center', fontSize: 10.5 } }, d[labelKey])
    );
  })
  );
}
function ChartCard({ title, children, range, onRange }) {
  return /*#__PURE__*/React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { marginBottom: 8 } }, /*#__PURE__*/
  React.createElement("h3", { style: { margin: 0, fontSize: 16 } }, title), /*#__PURE__*/React.createElement("span", { className: "spacer" }),
  onRange && /*#__PURE__*/React.createElement("div", { className: "range-pills" }, ['semana', 'mes'].map((r) => /*#__PURE__*/React.createElement("button", { key: r, className: 'pill ' + (range === r ? 'active' : ''), onClick: () => onRange(r) }, r)))
  ),
  children
  );
}

function Modal({ title, onClose, children, wide }) {
  return /*#__PURE__*/React.createElement("div", { className: "modal-bg", onClick: (e) => {if (e.target === e.currentTarget) onClose();} }, /*#__PURE__*/
  React.createElement("div", { className: "modal", style: wide ? { maxWidth: 760 } : {} }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { marginBottom: 12 } }, /*#__PURE__*/React.createElement("h3", { style: { margin: 0 } }, title), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("button", { className: "icon-btn", onClick: onClose }, "\u2715")),
  children
  )
  );
}

function StarRating({ value, onChange, size }) {
  return /*#__PURE__*/React.createElement("div", { className: "stars" }, [1, 2, 3, 4, 5].map((n) => /*#__PURE__*/React.createElement("span", { key: n, className: 'star ' + (n <= value ? 'filled' : ''), style: size ? { fontSize: size } : {}, onClick: () => onChange && onChange(n) }, "\u2605")));
}

function Toasts() {
  const { toasts } = useStore();
  return /*#__PURE__*/React.createElement("div", { className: "toast-wrap" }, toasts.map((t) => /*#__PURE__*/React.createElement("div", { key: t.id, className: "toast" }, t.msg)));
}

function Field({ label, children }) {return /*#__PURE__*/React.createElement("label", { className: "field" }, label, children);}

/* ============================= EDITAR PERFIL (todos los roles) ============================= */
function EditarPerfilModal({ persona, onSave, onClose, mostrarCumpleanos }) {
  const [nombre, setNombre] = useState(persona.nombre || '');
  const [telefono, setTelefono] = useState(persona.telefono || '');
  const [email, setEmail] = useState(persona.email || '');
  const [direccion, setDireccion] = useState(persona.direccion || '');
  const [cumpleanos, setCumpleanos] = useState(persona.cumpleanos || '');
  function guardar() {
    onSave({ nombre, telefono, email, direccion, ...(mostrarCumpleanos ? { cumpleanos } : {}) });
    onClose();
  }
  return /*#__PURE__*/React.createElement("div", { className: "modal-bg", onClick: (e) => {if (e.target === e.currentTarget) onClose();} }, /*#__PURE__*/
  React.createElement("div", { className: "modal", style: { maxWidth: 460 } }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { marginBottom: 4 } }, /*#__PURE__*/
  React.createElement("h3", { style: { margin: 0 } }, "\u270F\uFE0F Editar perfil"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/
  React.createElement("button", { className: "icon-btn", onClick: onClose }, "\u2715")
  ), /*#__PURE__*/
  React.createElement("p", { className: "small", style: { marginBottom: 16 } }, "Actualiza tu informaci\xF3n personal"), /*#__PURE__*/
  React.createElement("div", { className: "grid", style: { gap: 14 } }, /*#__PURE__*/
  React.createElement(Field, { label: "Nombre completo" }, /*#__PURE__*/React.createElement("input", { value: nombre, onChange: (e) => setNombre(e.target.value) })), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-2", style: { gap: 14 } }, /*#__PURE__*/
  React.createElement(Field, { label: "Tel\xE9fono" }, /*#__PURE__*/React.createElement("input", { value: telefono, onChange: (e) => setTelefono(e.target.value) })), /*#__PURE__*/
  React.createElement(Field, { label: "Correo electr\xF3nico" }, /*#__PURE__*/React.createElement("input", { type: "email", value: email, onChange: (e) => setEmail(e.target.value) }))
  ), /*#__PURE__*/
  React.createElement(Field, { label: "Direcci\xF3n principal" }, /*#__PURE__*/React.createElement("input", { placeholder: "Calle, n\xFAmero, colonia, ciudad", value: direccion, onChange: (e) => setDireccion(e.target.value) })),
  mostrarCumpleanos && /*#__PURE__*/React.createElement(Field, { label: "Fecha de cumplea\xF1os (opcional)" }, /*#__PURE__*/
  React.createElement("input", { type: "date", value: cumpleanos, onChange: (e) => setCumpleanos(e.target.value) })
  ),
  mostrarCumpleanos && /*#__PURE__*/React.createElement("p", { className: "small", style: { margin: 0 } }, "\uD83C\uDF82 Si el Administrador activa la promoci\xF3n de cumplea\xF1os, la usaremos para saludarte y darte un beneficio durante tu mes."), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", style: { marginTop: 6 }, onClick: guardar }, "\u2705 Guardar cambios")
  )
  )
  );
}
function PerfilCard({ persona, onGuardar, mostrarCumpleanos }) {
  const [editando, setEditando] = useState(false);
  return /*#__PURE__*/React.createElement("div", { className: "card", style: { maxWidth: 460 } }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow" }, /*#__PURE__*/React.createElement("strong", { style: { fontSize: 17 } }, persona.nombre), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: () => setEditando(true) }, "\u270F\uFE0F Editar perfil")
  ), /*#__PURE__*/
  React.createElement("div", { className: "small", style: { marginTop: 10 } }, /*#__PURE__*/React.createElement("strong", null, "Correo:"), " ", persona.email || '—'), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Tel\xE9fono:"), " ", persona.telefono || '—'), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Direcci\xF3n principal:"), " ", persona.direccion || '—'),
  mostrarCumpleanos && /*#__PURE__*/React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "\uD83C\uDF82 Cumplea\xF1os:"), " ", persona.cumpleanos ? fmtDate(persona.cumpleanos) : 'No registrado'),
  editando && /*#__PURE__*/React.createElement(EditarPerfilModal, { persona: persona, onClose: () => setEditando(false), onSave: onGuardar, mostrarCumpleanos: mostrarCumpleanos })
  );
}

/* ============================= TICKET VIEWER (sección 9) ============================= */
function TicketViewer({ ticket }) {
  const [open, setOpen] = useState(false);
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/
  React.createElement("div", { className: "flexrow" }, /*#__PURE__*/
  React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: () => setOpen(true) }, "\uD83D\uDC41 Ver ticket"), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary btn-sm", onClick: () => generarTicketPDF(ticket) }, "\uD83D\uDCE5 Descargar PDF")
  ),
  open && /*#__PURE__*/React.createElement(Modal, { title: 'Ticket ' + ticket.folio, onClose: () => setOpen(false) }, /*#__PURE__*/
  React.createElement("div", { style: { fontFamily: 'var(--font-body)' } }, /*#__PURE__*/
  React.createElement("div", { style: { textAlign: 'center', marginBottom: 10 } }, /*#__PURE__*/
  React.createElement("div", { className: "display", style: { fontSize: 22 } }, "\uD83D\uDC51 EL REY"), /*#__PURE__*/
  React.createElement("div", { className: "small" }, "Ticket digital (prototipo, sin valor fiscal)")
  ), /*#__PURE__*/
  React.createElement("hr", { className: "line" }), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Folio:"), " ", ticket.folio), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Fecha:"), " ", ticket.fecha, " ", ticket.hora), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Cliente:"), " ", ticket.clienteNombre || 'Mostrador'), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Correo:"), " ", ticket.clienteEmail || '—'), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Tipo de pedido:"), " ", ticket.tipoPedido),
  ticket.empleado && /*#__PURE__*/React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Atendi\xF3:"), " ", ticket.empleado), /*#__PURE__*/
  React.createElement("hr", { className: "line" }),
  (ticket.items || []).map((it, i) => /*#__PURE__*/React.createElement("div", { key: i, className: "flexrow small" }, /*#__PURE__*/React.createElement("span", null, it.cantidad || 1, "x ", it.nombre), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", null, money(it.total)))), /*#__PURE__*/
  React.createElement("hr", { className: "line" }), /*#__PURE__*/
  React.createElement("div", { className: "flexrow small" }, /*#__PURE__*/React.createElement("span", null, "Subtotal"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", null, money(ticket.subtotal))),
  ticket.descuento > 0 && /*#__PURE__*/React.createElement("div", { className: "flexrow small" }, /*#__PURE__*/React.createElement("span", null, "Descuento/cup\xF3n"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", null, "-", money(ticket.descuento))), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { fontWeight: 800, fontSize: 18, margin: '6px 0' } }, /*#__PURE__*/React.createElement("span", null, "TOTAL"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", null, money(ticket.total))), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "M\xE9todo de pago:"), " ", ticket.metodoPago),
  ticket.metodoPago === 'Efectivo' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Pago recibido:"), " ", money(ticket.pagoRecibido || ticket.total)), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Cambio:"), " ", money(ticket.cambio || 0))
  ),
  ticket.metodoPago === 'Transferencia' && /*#__PURE__*/React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Estado de pago:"), " ", /*#__PURE__*/React.createElement("span", { className: 'tag ' + (ticket.estadoPago === 'Pago confirmado' ? 'ok' : 'warn') }, ticket.estadoPago)), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Estado del pedido:"), " ", ticket.estadoPedido)
  )
  )
  );
}

/* ============================= CUENTAS DE CLIENTE (sección 4.3) ============================= */
function LoginUnico({ onDone }) {
  const { iniciarSesionUnico, registrarCliente, recuperarPasswordCliente, toast } = useStore();
  const [modo, setModo] = useState('login'); // login | registro | recuperar
  const [usuarioOCorreo, setUsuarioOCorreo] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password2, setPassword2] = useState('');
  const [cumpleanos, setCumpleanos] = useState('');
  const [error, setError] = useState('');

  function submitLogin() {
    const resultado = iniciarSesionUnico({ usuarioOCorreo, password });
    if (!resultado) {setError('Usuario/correo o contraseña incorrectos.');return;}
    if (resultado.tipo === 'prueba_vencida') {setError('⏳ Tu acceso de personal de prueba venció o fue desactivado. Pide al administrador que lo revise en "Personal de prueba".');return;}
    setError('');
    toast('👋 Bienvenido/a, ' + resultado.nombre);
    onDone && onDone();
  }
  function submitRegistro() {
    if (password !== password2) {setError('Las contraseñas no coinciden.');return;}
    const err = registrarCliente({ nombre, email, password, cumpleanos });
    if (err) {setError(err);return;}
    setError('');
    toast('✅ Cuenta creada. ¡Bienvenido/a!');
    onDone && onDone();
  }
  function submitRecuperar() {
    const ok = recuperarPasswordCliente(email);
    toast(ok ? '📩 Instrucciones de recuperación enviadas (simulado).' : 'No encontramos una cuenta con ese correo.');
  }

  if (modo === 'registro') {
    return /*#__PURE__*/React.createElement("div", { className: "card", style: { maxWidth: 420, margin: '0 auto' } }, /*#__PURE__*/
    React.createElement("h3", { style: { marginTop: 0 } }, "Crear cuenta"), /*#__PURE__*/
    React.createElement("p", { className: "small" }, "Solo para clientes nuevos \u2014 el personal del negocio (administrador, bartender, mesero, cocinera) ya tiene su cuenta creada por el administrador."),
    error && /*#__PURE__*/React.createElement("div", { className: "alert danger", style: { marginBottom: 10 } }, error), /*#__PURE__*/
    React.createElement("div", { className: "grid", style: { gap: 10 } }, /*#__PURE__*/
    React.createElement(Field, { label: "Nombre" }, /*#__PURE__*/React.createElement("input", { value: nombre, onChange: (e) => setNombre(e.target.value) })), /*#__PURE__*/
    React.createElement(Field, { label: "Correo electr\xF3nico" }, /*#__PURE__*/React.createElement("input", { type: "email", value: email, onChange: (e) => setEmail(e.target.value) })), /*#__PURE__*/
    React.createElement(Field, { label: "Fecha de cumplea\xF1os (opcional)" }, /*#__PURE__*/React.createElement("input", { type: "date", value: cumpleanos, onChange: (e) => setCumpleanos(e.target.value) })), /*#__PURE__*/
    React.createElement("p", { className: "small", style: { margin: 0 } }, "\uD83C\uDF82 Si el negocio activa promociones de cumplea\xF1os, la usaremos para darte un beneficio durante tu mes. Puedes dejarla en blanco y agregarla despu\xE9s desde tu perfil."), /*#__PURE__*/
    React.createElement(Field, { label: "Contrase\xF1a (m\xEDn. 6 caracteres)" }, /*#__PURE__*/React.createElement("input", { type: "password", value: password, onChange: (e) => setPassword(e.target.value) })), /*#__PURE__*/
    React.createElement(Field, { label: "Confirmar contrase\xF1a" }, /*#__PURE__*/React.createElement("input", { type: "password", value: password2, onChange: (e) => setPassword2(e.target.value) })), /*#__PURE__*/
    React.createElement("button", { className: "btn btn-primary", onClick: submitRegistro }, "Crear cuenta"), /*#__PURE__*/
    React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => {setModo('login');setError('');} }, "\u2190 Volver a iniciar sesi\xF3n")
    )
    );
  }
  if (modo === 'recuperar') {
    return /*#__PURE__*/React.createElement("div", { className: "card", style: { maxWidth: 420, margin: '0 auto' } }, /*#__PURE__*/
    React.createElement("h3", { style: { marginTop: 0 } }, "Recuperar contrase\xF1a"), /*#__PURE__*/
    React.createElement("p", { className: "small" }, "Simulado: no se env\xEDa correo real, solo se confirma si la cuenta existe. (Solo para cuentas de cliente; el personal debe pedirle al administrador que le restablezca su acceso.)"), /*#__PURE__*/
    React.createElement("div", { className: "grid", style: { gap: 10 } }, /*#__PURE__*/
    React.createElement(Field, { label: "Correo electr\xF3nico" }, /*#__PURE__*/React.createElement("input", { type: "email", value: email, onChange: (e) => setEmail(e.target.value) })), /*#__PURE__*/
    React.createElement("button", { className: "btn btn-primary", onClick: submitRecuperar }, "Enviar instrucciones"), /*#__PURE__*/
    React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => setModo('login') }, "\u2190 Volver a iniciar sesi\xF3n")
    )
    );
  }

  return /*#__PURE__*/React.createElement("div", { className: "card", style: { maxWidth: 420, margin: '0 auto' } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Iniciar sesi\xF3n"),
  error && /*#__PURE__*/React.createElement("div", { className: "alert danger", style: { marginBottom: 10 } }, error), /*#__PURE__*/
  React.createElement("div", { className: "grid", style: { gap: 10 } }, /*#__PURE__*/
  React.createElement(Field, { label: "Usuario o correo electr\xF3nico" }, /*#__PURE__*/React.createElement("input", { value: usuarioOCorreo, onChange: (e) => setUsuarioOCorreo(e.target.value), onKeyDown: (e) => {if (e.key === 'Enter') submitLogin();} })), /*#__PURE__*/
  React.createElement(Field, { label: "Contrase\xF1a" }, /*#__PURE__*/React.createElement("input", { type: "password", value: password, onChange: (e) => setPassword(e.target.value), onKeyDown: (e) => {if (e.key === 'Enter') submitLogin();} })), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", onClick: submitLogin }, "Iniciar sesi\xF3n"), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { marginTop: 4 } }, /*#__PURE__*/
  React.createElement("a", { onClick: () => {setModo('registro');setError('');}, className: "small", style: { cursor: 'pointer' } }, "Crear cuenta"), /*#__PURE__*/
  React.createElement("span", { className: "spacer" }), /*#__PURE__*/
  React.createElement("a", { onClick: () => {setModo('recuperar');setError('');}, className: "small", style: { cursor: 'pointer' } }, "Recuperar contrase\xF1a")
  )
  )
  );
}

/* ============================= PANEL LAYOUT ============================= */
function PanelLayout({ title, sections, section, setSection, badges = {}, children }) {
  const [colapsados, setColapsados] = useState({}); // {grupoLabel: true} = colapsado; por defecto todos expandidos
  const [menuAbierto, setMenuAbierto] = useState(false); // panel deslizable en móvil
  const sidebarCtx = useSidebar();
  const sidebarOculta = sidebarCtx ? sidebarCtx.oculta : false;
  function toggleGrupo(label) {setColapsados((c) => ({ ...c, [label]: !c[label] }));}
  function elegir(key) {setSection(key);setMenuAbierto(false);}
  return /*#__PURE__*/React.createElement("div", { className: "app-shell" },
  menuAbierto && /*#__PURE__*/React.createElement("div", { className: "sidebar-backdrop", onClick: () => setMenuAbierto(false) }), /*#__PURE__*/
  React.createElement("div", { className: 'sidebar ' + (menuAbierto ? 'mobile-open' : '') + (sidebarOculta ? ' sidebar-collapsed' : '') },
  sections.map((group) => {
    const cerrado = !!colapsados[group.label];
    return /*#__PURE__*/React.createElement("div", { className: "sb-group", key: group.label }, /*#__PURE__*/
    React.createElement("div", { className: "sb-group-header", onClick: () => toggleGrupo(group.label) }, /*#__PURE__*/
    React.createElement("span", { className: "sb-group-label" }, group.label), /*#__PURE__*/
    React.createElement("span", { className: 'sb-group-arrow ' + (cerrado ? '' : 'open') }, "\u25B6")
    ), /*#__PURE__*/
    React.createElement("div", { className: 'sb-items ' + (cerrado ? 'collapsed' : '') },
    group.items.map((it) => /*#__PURE__*/React.createElement("div", { key: it.key, className: 'sb-item ' + (section === it.key ? 'active' : ''), onClick: () => elegir(it.key) }, /*#__PURE__*/
    React.createElement("span", null, it.icon), /*#__PURE__*/React.createElement("span", null, it.label),
    badges[it.key] > 0 && /*#__PURE__*/React.createElement("span", { className: "sb-badge" }, badges[it.key])
    ))
    )
    );
  })
  ), /*#__PURE__*/
  React.createElement("div", { className: "content" }, /*#__PURE__*/
  React.createElement("button", { className: "sidebar-hamburger", onClick: () => setMenuAbierto(true) }, "\u2630"),
  children
  )
  );
}

/* ============================= REGISTRAR VENTA (compartido) ============================= */
function VentaForm({ onDone, meseroDefault }) {
  const { state, setState, pushTo, allProducts, notify, toast, otorgarCortesia } = useStore();
  const [productoId, setProductoId] = useState('');
  const [varIdx, setVarIdx] = useState(0);
  const [sabor, setSabor] = useState('');
  const [toppings, setToppings] = useState([]);
  const [piezasTopping1, setPiezasTopping1] = useState(null); // null = repartir parejo por defecto
  const [piezasPersonalizadas, setPiezasPersonalizadas] = useState(''); // para Alitas con "Cantidad personalizada"
  const [cerveza, setCerveza] = useState('');
  const [conAlcohol, setConAlcohol] = useState(true);
  const [cantidad, setCantidad] = useState(1);
  const [mesero, setMesero] = useState(meseroDefault || (state.staff.find((s) => s.rol === 'mesero') || {}).nombre || '');
  const [pago, setPago] = useState('efectivo');
  const [recibido, setRecibido] = useState('');
  const [entrega, setEntrega] = useState('establecimiento');
  const [aderezo, setAderezo] = useState('si');
  const [modoPago, setModoPago] = useState('ahora');
  const [mesaSeleccionada, setMesaSeleccionada] = useState('');
  const [clienteCortesia, setClienteCortesia] = useState('');
  const [busquedaBebida, setBusquedaBebida] = useState('');

  const prod = allProducts.find((p) => p.id === productoId);
  const varianteBase = prod ? prod.variantes[varIdx] : null;
  const variante = prod && prod.requiereAlitasCombo ? varianteEfectivaAlitas(varianteBase, piezasPersonalizadas) : varianteBase;
  const total = variante ? variante.precio * cantidad : 0;
  const cambio = pago === 'efectivo' && recibido ? Math.max(0, Number(recibido) - total) : 0;
  const esComida = prod && prod.tipo === 'comida';
  const tiempoPrep = prod ? esComida ? minutosPrepBase(state, prod.categoria, prod.nombre, variante ? variante.nombre : '') + ' min' : tiempoPreparacionBebida(prod.categoriaId) : null;
  const cocinaAbiertaAhora = cocinaEfectivamenteAbierta(state);

  // Regla de negocio: el mesero solo registra ventas de bebidas para consumo en el local;
  // las bebidas "para llevar" las registra el Cantinero (bartender) desde su propio panel.
  const rolActual = (state.staff.find((s) => s.id === state.staffSession) || {}).rol;
  const esBartenderRegistrando = rolActual === 'bartender';
  // --- Autocompletado de bebidas preparadas con alcohol y licores (solo para el Cantinero) ---
  const opcionesAutocompletar = useMemo(() => allProducts.filter((p) => p.categoriaId === 'preparadas' || p.categoriaId === 'licores'), [allProducts]);
  function seleccionarBebidaAutocompletada(nombre) {
    setBusquedaBebida(nombre);
    const encontrado = opcionesAutocompletar.find((p) => p.nombre.toLowerCase() === nombre.toLowerCase().trim());
    if (encontrado) {
      setProductoId(encontrado.id);setVarIdx(0);setSabor('');setToppings([]);setCerveza('');
      toast('✨ ' + encontrado.nombre + ' — categoría, variante y precio autocompletados');
    }
  }
  const esMeseroRegistrando = rolActual === 'mesero';
  const llevarBloqueadoParaMesero = esMeseroRegistrando && prod && !esComida;
  useEffect(() => {if (llevarBloqueadoParaMesero && entrega === 'llevar') setEntrega('establecimiento');}, [llevarBloqueadoParaMesero]);
  useEffect(() => {if (entrega !== 'establecimiento') {setModoPago('ahora');setMesaSeleccionada('');}}, [entrega]);

  // --- Promoción de bebida de cortesía por temporada (sección 1): aplica también a ventas registradas por el personal ---
  const cortesiaPromo = state.cortesiaPromo;
  const mostrarCampoCortesia = !!(cortesiaPromo && cortesiaPromo.activa && prod && !esComida);

  function submit() {
    if (state.negocioAbierto === false) {toast('🔒 El negocio está cerrado por hoy, vuelve mañana.');return;}
    if (!prod) {toast('Selecciona un producto');return;}
    if (prod.agotado) {toast('🔴 Ese producto está agotado — no se puede vender hasta que el Cantinero lo reponga.');return;}
    if (prod.requiereCerveza && !cerveza) {toast('Selecciona de qué cerveza es la michelada');return;}
    if (prod.requiereAlitasCombo) {
      if (varianteBase && varianteBase.personalizada && (Number(piezasPersonalizadas) || 0) <= 0) {toast('Escribe cuántas piezas de alitas en total');return;}
      if (toppings.length === 0) {toast('Elige al menos 1 sabor para las alitas (máximo 2).');return;}
      if (toppings.some((t) => saborEstaAgotado(state, prod.categoriaId, t))) {toast('🚫 Uno de los sabores elegidos está agotado — revisa la selección.');return;}
    } else if (sabor && saborEstaAgotado(state, prod.categoriaId, sabor)) {toast('🚫 Ese sabor está agotado — elige otro.');return;}
    if (esComida && !cocinaAbiertaAhora) {toast('🍳 Cocina cerrada — disponible desde las ' + horaTexto12(cocinaHorarioActual(state).horaApertura) + '. No se pueden tomar pedidos de comida.');return;}
    if (llevarBloqueadoParaMesero && entrega === 'llevar') {toast('Las bebidas para llevar las registra el Cantinero, no el Mesero.');return;}
    const esCuentaMesa = entrega === 'establecimiento' && modoPago === 'cuenta_mesa';
    if (esCuentaMesa && !mesaSeleccionada) {toast('Selecciona a qué mesa se agrega el consumo');return;}
    const mesaInfo = esCuentaMesa ? state.tables.find((t) => t.id === mesaSeleccionada) : null;
    const totalPiezasAlitas = prod.requiereAlitasCombo ? piezasDeVariante(variante.nombre) * cantidad : 0;
    const piezas1 = piezasTopping1 !== null ? piezasTopping1 : Math.ceil(totalPiezasAlitas / 2);
    const piezas2 = totalPiezasAlitas - piezas1;
    const saborFinal = prod.requiereAlitasCombo ?
    toppings.length === 2 ? piezas1 + ' ' + toppings[0] + ' + ' + piezas2 + ' ' + toppings[1] : toppings.join(' + ') :
    sabor;
    const venta = {
      id: uid('sale'), fecha: todayISO(), hora: nowTime(), mesero, pago: esCuentaMesa ? 'cuenta_mesa' : pago,
      producto: prod.nombre, categoria: prod.categoria, variante: variante.nombre, sabor: saborFinal || null, cerveza: cerveza || null,
      conAlcohol: prod.categoriaId === 'preparadas' ? conAlcohol : null,
      cantidad, precioUnit: variante.precio, total, cambio: !esCuentaMesa && pago === 'efectivo' ? cambio : 0, entrega,
      mesaNumero: mesaInfo ? mesaInfo.numero : undefined, zona: mesaInfo ? mesaInfo.zona : undefined,
      aderezo: esComida ? aderezo === 'si' : null, estadoPedido: 'Pedido recibido',
      estadoPago: esCuentaMesa ? 'cuenta_abierta' : 'confirmado'
    };
    pushTo('sales', venta);
    if (esCuentaMesa) {
      const nombreCompleto = prod.nombre + ' (' + variante.nombre + (cerveza ? ', ' + cerveza : '') + (saborFinal ? ', ' + saborFinal : '') + ')';
      agregarACuentaAbiertaMesa(setState, mesaInfo, mesero, { ventaId: venta.id, nombre: nombreCompleto, cantidad, total, hora: nowTime() });
    }
    if (mostrarCampoCortesia) {
      let bebidaCortesia = null;
      if (cortesiaPromo.modo === 'fija' && cortesiaPromo.bebidaFijaId) {
        const fija = allProducts.find((p) => p.id === cortesiaPromo.bebidaFijaId);
        bebidaCortesia = fija ? fija.nombre : null;
      } else {
        bebidaCortesia = prod.nombre + ' (' + variante.nombre + (sabor ? ', ' + sabor : '') + ')';
      }
      if (bebidaCortesia) {
        otorgarCortesia({ tipo: 'promo_temporada', clienteNombre: clienteCortesia.trim() || 'Mesa/atendido por ' + mesero, clienteEmail: '', bebida: bebidaCortesia, ventaId: venta.id, motivo: 'Promoción de cortesía activa' });
        toast('🎁 Cortesía registrada para el Cantinero: ' + bebidaCortesia);
      }
    }
    toast(esCuentaMesa ?
    '🧾 Se agregó a la cuenta de Mesa ' + mesaInfo.numero + ' (' + mesaInfo.zona + '): ' + prod.nombre + ' — ' + money(total) :
    '✅ Venta registrada: ' + prod.nombre + ' — ' + money(total) + (tiempoPrep ? ' · Tiempo estimado: ' + tiempoPrep : ''));
    setClienteCortesia('');
    setMesaSeleccionada('');
    onDone && onDone();
  }

  return /*#__PURE__*/React.createElement("div", { className: "grid grid-2" },
  state.negocioAbierto === false && /*#__PURE__*/React.createElement("div", { className: "alert danger", style: { gridColumn: '1 / -1' } }, "\uD83D\uDD12 ", /*#__PURE__*/React.createElement("strong", null, "El negocio est\xE1 cerrado por hoy."), " No se pueden registrar ventas nuevas hasta que el Cantinero (o el Admin) lo vuelva a abrir."),
  !cocinaAbiertaAhora && /*#__PURE__*/React.createElement("div", { className: "alert danger", style: { gridColumn: '1 / -1' } }, "\uD83C\uDF73 ", /*#__PURE__*/React.createElement("strong", null, "La cocina est\xE1 cerrada"), " (disponible desde las ", horaTexto12(cocinaHorarioActual(state).horaApertura), ") \u2014 no se pueden tomar pedidos de comida. El servicio de barra sigue disponible."),
  esBartenderRegistrando && /*#__PURE__*/React.createElement(Field, { label: "\uD83D\uDD0D Autocompletar bebida con alcohol / licor" }, /*#__PURE__*/
  React.createElement("input", { list: "bebidas-alcohol-datalist", placeholder: "Escribe: Mojito, Pi\xF1a colada, Fresa colada, un licor\u2026", value: busquedaBebida, onChange: (e) => seleccionarBebidaAutocompletada(e.target.value) }), /*#__PURE__*/
  React.createElement("datalist", { id: "bebidas-alcohol-datalist" },
  opcionesAutocompletar.map((p) => /*#__PURE__*/React.createElement("option", { key: p.id, value: p.nombre }))
  ), /*#__PURE__*/
  React.createElement("div", { className: "small", style: { marginTop: 4 } }, "Incluye Mojito de frutos rojos, Mojito natural, Pi\xF1a colada, Fresa colada y los licores del cat\xE1logo. Al elegir una opci\xF3n se autocompletan categor\xEDa, variante y precio abajo.")
  ), /*#__PURE__*/
  React.createElement(Field, { label: "Producto" }, /*#__PURE__*/
  React.createElement("select", { value: productoId, onChange: (e) => {setProductoId(e.target.value);setVarIdx(0);setSabor('');setToppings([]);setCerveza('');setPiezasPersonalizadas('');setPiezasTopping1(null);} }, /*#__PURE__*/
  React.createElement("option", { value: "" }, "Selecciona\u2026"),
  state.catalog.map((cat) => /*#__PURE__*/React.createElement("optgroup", { key: cat.id, label: cat.nombre },
  cat.productos.map((p) => /*#__PURE__*/React.createElement("option", { key: p.id, value: p.id, disabled: p.agotado || cat.tipo === 'comida' && !cocinaAbiertaAhora }, p.nombre, p.agotado ? ' (AGOTADO)' : cat.tipo === 'comida' && !cocinaAbiertaAhora ? ' (cocina cerrada)' : ''))
  ))
  ),
  prod && prod.agotado && /*#__PURE__*/React.createElement("div", { className: "tag danger", style: { marginTop: 6 } }, "\uD83D\uDD34 Este producto est\xE1 marcado como agotado por el Cantinero.")
  ), /*#__PURE__*/
  React.createElement(Field, { label: "Presentaci\xF3n / variante" }, /*#__PURE__*/
  React.createElement("select", { value: varIdx, onChange: (e) => {setVarIdx(Number(e.target.value));setPiezasPersonalizadas('');}, disabled: !prod },
  prod && prod.variantes.map((v, i) => /*#__PURE__*/React.createElement("option", { key: i, value: i }, v.personalizada ? v.nombre + ' (tú indicas cuántas)' : v.nombre + ' — ' + money(v.precio)))
  )
  ),
  varianteBase && varianteBase.personalizada && /*#__PURE__*/React.createElement(Field, { label: '¿Cuántas piezas en total? ($' + PRECIO_POR_PIEZA_ALITA + '/pza)' }, /*#__PURE__*/
  React.createElement("input", { type: "number", min: "1", value: piezasPersonalizadas, onChange: (e) => setPiezasPersonalizadas(e.target.value), placeholder: "Ej. 15" }),
  Number(piezasPersonalizadas) > 0 && /*#__PURE__*/React.createElement("div", { className: "small", style: { marginTop: 4 } }, "Precio: ", money(Number(piezasPersonalizadas) * PRECIO_POR_PIEZA_ALITA))
  ),
  prod && prod.requiereCerveza && prod.cervezas && /*#__PURE__*/React.createElement(Field, { label: "\xBFDe qu\xE9 cerveza?" }, /*#__PURE__*/
  React.createElement("select", { value: cerveza, onChange: (e) => setCerveza(e.target.value) }, /*#__PURE__*/
  React.createElement("option", { value: "" }, "Selecciona\u2026"),
  prod.cervezas.map((c) => /*#__PURE__*/React.createElement("option", { key: c, value: c }, c))
  )
  ),
  prod && prod.sabores && prod.sabores.length > 0 && !prod.requiereAlitasCombo && /*#__PURE__*/React.createElement(Field, { label: "Sabor (sin costo extra)" }, /*#__PURE__*/
  React.createElement("select", { value: sabor, onChange: (e) => setSabor(e.target.value) }, /*#__PURE__*/
  React.createElement("option", { value: "" }, "Sin especificar"),
  prod.sabores.map((s) => {const agotado = saborEstaAgotado(state, prod.categoriaId, s);return /*#__PURE__*/React.createElement("option", { key: s, value: s, disabled: agotado }, agotado ? '🚫 ' + s + ' (agotado)' : s);})
  )
  ),
  prod && prod.requiereAlitasCombo && prod.sabores && prod.sabores.length > 0 && /*#__PURE__*/React.createElement(Field, { label: 'Sabor(es) — elige hasta 2 (' + toppings.length + '/2)' }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { flexWrap: 'wrap', gap: 8 } },
  prod.sabores.map((s) => {
    const agotado = saborEstaAgotado(state, prod.categoriaId, s);
    const marcado = toppings.includes(s);
    return /*#__PURE__*/React.createElement("button", { type: "button", key: s, className: 'btn btn-sm ' + (marcado ? 'btn-primary' : 'btn-secondary'),
      disabled: agotado || !marcado && toppings.length >= 2,
      onClick: () => {setPiezasTopping1(null);marcado ? setToppings(toppings.filter((t) => t !== s)) : setToppings([...toppings, s]);} },
    agotado ? '🚫 ' + s : s
    );
  })
  ),
  toppings.length < 2 && /*#__PURE__*/React.createElement("div", { className: "small", style: { marginTop: 6 } }, toppings.length === 0 ? 'Elige al menos 1 sabor.' : 'Todas las piezas serán de ' + toppings[0] + '. Puedes elegir un 2º sabor para combinar.'),
  toppings.length === 2 && /*#__PURE__*/React.createElement("div", { style: { marginTop: 10 } }, /*#__PURE__*/
  React.createElement("div", { className: "small", style: { marginBottom: 6 } }, "\xBFCu\xE1ntas piezas de cada sabor? (de ", piezasDeVariante(variante.nombre) * cantidad, " piezas en total)"), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-2" }, /*#__PURE__*/
  React.createElement(Field, { label: toppings[0] + ' (piezas)' }, /*#__PURE__*/
  React.createElement("input", { type: "number", min: "0", max: piezasDeVariante(variante.nombre) * cantidad,
    value: piezasTopping1 !== null ? piezasTopping1 : Math.ceil(piezasDeVariante(variante.nombre) * cantidad / 2),
    onChange: (e) => {const tot = piezasDeVariante(variante.nombre) * cantidad;setPiezasTopping1(Math.max(0, Math.min(tot, Number(e.target.value) || 0)));} })
  ), /*#__PURE__*/
  React.createElement(Field, { label: toppings[1] + ' (piezas)' }, /*#__PURE__*/
  React.createElement("input", { type: "number", value: piezasDeVariante(variante.nombre) * cantidad - (piezasTopping1 !== null ? piezasTopping1 : Math.ceil(piezasDeVariante(variante.nombre) * cantidad / 2)), readOnly: true })
  )
  )
  )
  ),
  prod && prod.categoriaId === 'preparadas' && /*#__PURE__*/React.createElement(Field, { label: "Preparaci\xF3n" }, /*#__PURE__*/
  React.createElement("select", { value: conAlcohol ? 'con' : 'sin', onChange: (e) => setConAlcohol(e.target.value === 'con') }, /*#__PURE__*/
  React.createElement("option", { value: "con" }, "Con alcohol"), /*#__PURE__*/React.createElement("option", { value: "sin" }, "Sin alcohol")
  )
  ), /*#__PURE__*/
  React.createElement(Field, { label: "Cantidad" }, /*#__PURE__*/React.createElement("input", { type: "number", min: "1", value: cantidad, onChange: (e) => setCantidad(Number(e.target.value) || 1) })), /*#__PURE__*/
  React.createElement(Field, { label: "Mesero" }, /*#__PURE__*/
  React.createElement("select", { value: mesero, onChange: (e) => setMesero(e.target.value) },
  state.staff.filter((s) => s.rol === 'mesero').map((s) => /*#__PURE__*/React.createElement("option", { key: s.id, value: s.nombre }, s.nombre))
  )
  ), /*#__PURE__*/
  React.createElement(Field, { label: "Tipo de entrega" }, /*#__PURE__*/
  React.createElement("select", { value: entrega, onChange: (e) => setEntrega(e.target.value) }, /*#__PURE__*/
  React.createElement("option", { value: "establecimiento" }, "Consumo en establecimiento"),
  !llevarBloqueadoParaMesero && /*#__PURE__*/React.createElement("option", { value: "llevar" }, "Para llevar"), /*#__PURE__*/
  React.createElement("option", { value: "domicilio" }, "A domicilio")
  ),
  llevarBloqueadoParaMesero && /*#__PURE__*/React.createElement("div", { className: "small", style: { marginTop: 4 } }, "\uD83C\uDF79 Las bebidas para llevar las registra el Cantinero desde su panel \u2014 el Mesero solo registra consumo en el local.")
  ),
  entrega === 'establecimiento' && /*#__PURE__*/React.createElement(Field, { label: "Mesa" }, /*#__PURE__*/
  React.createElement("select", { value: mesaSeleccionada, onChange: (e) => setMesaSeleccionada(e.target.value) }, /*#__PURE__*/
  React.createElement("option", { value: "" }, "Sin especificar / barra"),
  state.tables.map((t) => /*#__PURE__*/React.createElement("option", { key: t.id, value: t.id }, t.zona, " \u2014 Mesa ", t.numero))
  )
  ),
  entrega === 'establecimiento' && /*#__PURE__*/React.createElement(Field, { label: "\xBFCu\xE1ndo se paga?" }, /*#__PURE__*/
  React.createElement("select", { value: modoPago, onChange: (e) => setModoPago(e.target.value) }, /*#__PURE__*/
  React.createElement("option", { value: "ahora" }, "Pagar ahora"), /*#__PURE__*/
  React.createElement("option", { value: "cuenta_mesa" }, "Agregar a la cuenta de la mesa (pagar despu\xE9s)")
  ),
  modoPago === 'cuenta_mesa' && /*#__PURE__*/React.createElement("div", { className: "small", style: { marginTop: 4 } }, "\uD83E\uDDFE Se manda a preparar igual, pero se acumula en la cuenta de la mesa hasta que la cobres desde \"Cuentas abiertas\".")
  ),
  esComida && /*#__PURE__*/React.createElement(Field, { label: "\xBFCon aderezo / complementos?" }, /*#__PURE__*/
  React.createElement("select", { value: aderezo, onChange: (e) => setAderezo(e.target.value) }, /*#__PURE__*/
  React.createElement("option", { value: "si" }, "S\xED, con aderezo/complementos"), /*#__PURE__*/
  React.createElement("option", { value: "no" }, "No, sin aderezo")
  )
  ),
  mostrarCampoCortesia && /*#__PURE__*/React.createElement(Field, { label: "\uD83C\uDF81 Cliente para la cortes\xEDa (promo de temporada activa)" }, /*#__PURE__*/
  React.createElement("input", { placeholder: "Nombre del cliente o mesa (opcional)", value: clienteCortesia, onChange: (e) => setClienteCortesia(e.target.value) })
  ),
  !(entrega === 'establecimiento' && modoPago === 'cuenta_mesa') && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/
  React.createElement(Field, { label: "M\xE9todo de pago" }, /*#__PURE__*/
  React.createElement("select", { value: pago, onChange: (e) => setPago(e.target.value) }, /*#__PURE__*/
  React.createElement("option", { value: "efectivo" }, "Efectivo"), /*#__PURE__*/React.createElement("option", { value: "transferencia" }, "Transferencia")
  )
  ),
  pago === 'efectivo' && /*#__PURE__*/React.createElement(Field, { label: "Efectivo recibido" }, /*#__PURE__*/React.createElement("input", { type: "number", value: recibido, onChange: (e) => setRecibido(e.target.value) })),
  pago === 'transferencia' && /*#__PURE__*/React.createElement("div", { className: "card", style: { gridColumn: '1/-1', background: 'var(--bg-soft)' } }, /*#__PURE__*/
  React.createElement("div", { className: "small", style: { fontWeight: 700, marginBottom: 4 } }, "\uD83D\uDCCB Dale estos datos al cliente para que transfiera:"), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Titular:"), " ", state.transferAccount.titular), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Banco:"), " ", state.transferAccount.banco), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "CLABE:"), " ", state.transferAccount.clabe), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "N\xFAmero de cuenta:"), " ", state.transferAccount.cuenta)
  )
  ),
  tiempoPrep && /*#__PURE__*/React.createElement("div", { className: "alert", style: { gridColumn: '1/-1' } }, "\u23F1\uFE0F Tiempo estimado de preparaci\xF3n: ", /*#__PURE__*/React.createElement("strong", null, tiempoPrep), ". Av\xEDsale al cliente para que lo sepa."), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { gridColumn: '1/-1', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, /*#__PURE__*/
  React.createElement("div", null, /*#__PURE__*/React.createElement("div", { className: "small" }, "Total"), /*#__PURE__*/React.createElement("div", { style: { fontSize: 22, fontWeight: 800 } }, money(total))),
  !(entrega === 'establecimiento' && modoPago === 'cuenta_mesa') && pago === 'efectivo' && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", { className: "small" }, "Cambio"), /*#__PURE__*/React.createElement("div", { style: { fontSize: 18, fontWeight: 800, color: 'var(--ok)' } }, money(cambio))), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", disabled: state.negocioAbierto === false, onClick: submit }, entrega === 'establecimiento' && modoPago === 'cuenta_mesa' ? 'Agregar a la cuenta de la mesa' : 'Registrar venta')
  )
  );
}

/* ============================= VISTA PÚBLICA / CLIENTE ============================= */
// Banner para el cliente: avisos de "listo para recoger" (para llevar) y avisos de demora en su bebida/comida.
function ClientePedidoListoBanner() {
  const { state, currentCustomer, updateItem, toast } = useStore();
  if (!currentCustomer) return null;
  const listos = state.notifications.filter((n) => n.tipo === 'pedido_listo' && n.destino === 'cliente' && !n.atendido && n.clienteEmail === currentCustomer.email);
  const demoras = state.notifications.filter((n) => n.tipo === 'aviso_demora' && n.destino === 'cliente' && !n.atendido && n.clienteEmail === currentCustomer.email);
  const eventosAprobados = state.notifications.filter((n) => n.tipo === 'evento_aprobado' && n.destino === 'cliente' && !n.atendido && n.clienteEmail === currentCustomer.email);
  if (listos.length === 0 && demoras.length === 0 && eventosAprobados.length === 0) return null;
  function recoger(n) {
    updateItem('notifications', n.id, { atendido: true });
    if (n.ventaId) updateItem('sales', n.ventaId, { estadoPedido: 'Entregado' });
    toast('¡Buen provecho! 🎉');
  }
  function descartarDemora(n) {updateItem('notifications', n.id, { atendido: true });}
  return /*#__PURE__*/React.createElement("div", { style: { padding: '10px 24px 0' } },
  eventosAprobados.map((n) => /*#__PURE__*/React.createElement("div", { key: n.id, className: "alert", style: { marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(47,174,78,.12)', borderColor: 'var(--ok)' } }, /*#__PURE__*/
  React.createElement("span", { style: { flex: 1 } }, "\uD83C\uDF89 \xA1Tu evento fue aprobado! Tu folio es ", /*#__PURE__*/React.createElement("strong", null, n.folio), " \u2014 gu\xE1rdalo, es tu entrada digital. (Notificaci\xF3n simulada: WhatsApp/correo)"), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: () => updateItem('notifications', n.id, { atendido: true }) }, "Entendido")
  )),
  listos.map((n) => /*#__PURE__*/React.createElement("div", { key: n.id, className: "alert", style: { marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 } }, /*#__PURE__*/
  React.createElement("span", { style: { flex: 1 } }, n.origen === 'barra' ? '🥤' : '🍽️', " \xA1Tu ", /*#__PURE__*/React.createElement("strong", null, n.producto), " ya est\xE1 lista para llevar! Puedes pasar a recogerla."), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: () => recoger(n) }, "Ya la recog\xED")
  )),
  demoras.map((n) => /*#__PURE__*/React.createElement("div", { key: n.id, className: "alert danger", style: { marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 } }, /*#__PURE__*/
  React.createElement("span", { style: { flex: 1 } }, "\u23F3 Tu ", /*#__PURE__*/React.createElement("strong", null, n.producto), " tardar\xE1 ", /*#__PURE__*/React.createElement("strong", null, n.minutos, " min"), " m\xE1s de lo previsto \u2014 ", n.motivo, ". \xA1Gracias por tu paciencia!"), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => descartarDemora(n) }, "Entendido")
  ))
  );
}
// Avisa a los clientes del horario especial de cierre (cocina/establecimiento) cuando el Admin lo tiene activo.
function NegocioCerradoAvisoCliente() {
  const { state } = useStore();
  if (state.negocioAbierto !== false) return null;
  return /*#__PURE__*/React.createElement("div", { style: { padding: '10px 24px 0' } }, /*#__PURE__*/
  React.createElement("div", { className: "alert danger" }, "\uD83D\uDD12 ", /*#__PURE__*/React.createElement("strong", null, "El negocio est\xE1 cerrado por hoy, vuelve ma\xF1ana."), " No se pueden hacer pedidos nuevos en este momento.")
  );
}
function HorarioCierreAvisoCliente() {
  const { state } = useStore();
  const hc = state.horariosCierre;
  if (!hc || !hc.activo) return null;
  const cocinaCerrada = cocinaCerradaPorHorario(hc);
  const estCerrado = establecimientoCerradoPorHorario(hc);
  return /*#__PURE__*/React.createElement("div", { style: { padding: '10px 24px 0' } }, /*#__PURE__*/
  React.createElement("div", { className: 'alert ' + (estCerrado ? 'danger' : cocinaCerrada ? '' : '') }, "\uD83D\uDD5B Horario especial de temporada: cocina cierra a las ", /*#__PURE__*/
  React.createElement("strong", null, hc.cierreCocina), " \xB7 establecimiento cierra a las ", /*#__PURE__*/React.createElement("strong", null, hc.cierreEstablecimiento), ".",
  estCerrado ? ' Ya estamos cerrando por hoy — no se aceptan más pedidos.' : cocinaCerrada ? ' La cocina ya cerró — sigue disponible el servicio de barra.' : ''
  )
  );
}
function ClienteView() {
  const { state, setState, pushTo, updateItem, allProducts, toast, log, currentCustomer, temaActivo } = useStore();
  const [slide, setSlide] = useState(0);
  const [tab, setTab] = useState('inicio');
  // Tick periódico: fuerza un re-render para que los bloqueos por horario de cierre (sección 3) se reflejen
  // en vivo aunque el cliente no interactúe con nada más.
  const [, setTick] = useState(0);
  useEffect(() => {const t = setInterval(() => setTick((x) => x + 1), 20000);return () => clearInterval(t);}, []);
  const slides = [
  { emoji: '🍺', title: 'MICHELADA', accent: 'DE VICTORIA', sub: '12 sabores, cero costo extra. La favorita de la casa desde siempre.', bg: 'linear-gradient(135deg,#2b1712,#4a2115)' },
  { emoji: '🍹', title: 'AZULITO Y', accent: 'ROSADITO', sub: 'Bebidas preparadas con opción de medio y con/sin alcohol.', bg: 'linear-gradient(135deg,#0e1a2e,#123048)' },
  { emoji: '🍗', title: 'ORDEN DE', accent: 'ALITAS', sub: '13 sabores. Del pica-pica al infierno con Diablo y Habanero.', bg: 'linear-gradient(135deg,#2a1508,#4a1f08)' },
  { emoji: '👑', title: 'EL REY', accent: 'TRADICIONAL', sub: 'La especialidad de la casa. Fondo oscuro, sabor que reina.', bg: 'linear-gradient(135deg,#160a17,#3a0f1e)' }];

  useEffect(() => {const t = setInterval(() => setSlide((s) => (s + 1) % slides.length), 4500);return () => clearInterval(t);}, []);

  const activeCampaigns = state.campaigns.filter((c) => c.activa);

  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("div", { className: "public-nav" }, /*#__PURE__*/
  React.createElement("div", { className: "brand" }, /*#__PURE__*/React.createElement("span", { className: "crown" }, "\uD83D\uDC51"), " EL REY"), /*#__PURE__*/
  React.createElement("div", { className: "links" },
  ['inicio', 'menu', 'eventos', 'conocenos', 'videos'].map((t) => /*#__PURE__*/React.createElement("a", { key: t, onClick: () => setTab(t), style: { color: tab === t ? 'var(--neon)' : 'inherit' } }, { inicio: 'Inicio', menu: 'Menú', eventos: 'Eventos', conocenos: 'Conócenos', videos: 'Videos' }[t]))
  ), /*#__PURE__*/
  React.createElement("div", { className: "flexrow" },
  currentCustomer ? /*#__PURE__*/
  React.createElement("a", { onClick: () => setTab('cuenta'), style: { color: tab === 'cuenta' ? 'var(--neon)' : 'inherit', fontWeight: 700, cursor: 'pointer' } }, "\uD83D\uDC64 ", currentCustomer.nombre.split(' ')[0], " \xB7 Mi cuenta") : /*#__PURE__*/
  React.createElement("a", { onClick: () => setTab('cuenta'), style: { color: tab === 'cuenta' ? 'var(--neon)' : 'inherit', fontWeight: 700, cursor: 'pointer' } }, "Iniciar sesi\xF3n"), /*#__PURE__*/
  React.createElement(ThemeToggle, null)
  )
  ), /*#__PURE__*/
  React.createElement(ClientePedidoListoBanner, null), /*#__PURE__*/
  React.createElement(NegocioCerradoAvisoCliente, null), /*#__PURE__*/
  React.createElement(HorarioCierreAvisoCliente, null), /*#__PURE__*/

  React.createElement("div", { className: "hero" },
  slides.map((s, i) => /*#__PURE__*/React.createElement("div", { key: i, className: 'hero-slide ' + (i === slide ? 'active' : ''), style: { background: s.bg } }, /*#__PURE__*/
  React.createElement("div", { className: "hero-content" }, /*#__PURE__*/
  React.createElement("div", { className: "hero-eyebrow" }, "Bar de micheladas y bebidas"), /*#__PURE__*/
  React.createElement("div", { className: "hero-title" }, s.emoji, " ", s.title, /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("span", { className: "accent" }, s.accent)), /*#__PURE__*/
  React.createElement("div", { className: "hero-sub" }, s.sub), /*#__PURE__*/
  React.createElement("div", { className: "flexrow" }, /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", onClick: () => setTab('menu') }, "Ver men\xFA completo"), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-secondary", onClick: () => setTab('eventos') }, "Cotizar evento")
  )
  )
  )), /*#__PURE__*/
  React.createElement("div", { className: "hero-dots" }, slides.map((_, i) => /*#__PURE__*/React.createElement("button", { key: i, className: 'hero-dot ' + (i === slide ? 'active' : ''), onClick: () => setSlide(i) })))

  ), /*#__PURE__*/

  React.createElement("div", { className: "section" }, /*#__PURE__*/
  React.createElement("div", { className: "small", style: { marginBottom: 10 } }, "Horario: Lunes 1:00pm\u20137:50pm \xB7 Martes a Domingo 2:00pm\u201310:50pm"),
  activeCampaigns.length > 0 && /*#__PURE__*/React.createElement("div", { className: "flexrow", style: { marginBottom: 20 } },
  activeCampaigns.map((c) => /*#__PURE__*/React.createElement("span", { key: c.id, className: "chip", style: { fontSize: 12 } }, c.emoji, " ", c.nombre, " \u2014 promo activa"))
  )
  ),

  tab === 'menu' && /*#__PURE__*/React.createElement("div", { className: "section" }, /*#__PURE__*/
  React.createElement("div", { className: "section-head" }, /*#__PURE__*/React.createElement("div", { className: "section-eyebrow" }, "Cat\xE1logo"), /*#__PURE__*/React.createElement("h2", { className: "section-title" }, "Todo lo que servimos")), /*#__PURE__*/
  React.createElement("p", { className: "small", style: { marginTop: -10, marginBottom: 16 } }, "Elige \"Pedir\" en cualquier producto para generar tu folio y ticket digital."),
  state.catalog.map((cat) => {
    const cocinaCerradaCat = cat.tipo === 'comida' && !cocinaEfectivamenteAbierta(state);
    return /*#__PURE__*/React.createElement("div", { key: cat.id, style: { marginBottom: 30 } }, /*#__PURE__*/
    React.createElement("h3", { style: { fontSize: 20, marginBottom: 10 } }, EMOJI[cat.id], " ", cat.nombre, " ", cat.soloLocal && /*#__PURE__*/React.createElement("span", { className: "tag warn" }, "Solo en el local"), " ", cocinaCerradaCat && /*#__PURE__*/React.createElement("span", { className: "tag danger" }, "\uD83C\uDF73 Cocina cerrada \u2014 disponible desde las ", horaTexto12(cocinaHorarioActual(state).horaApertura))), /*#__PURE__*/
    React.createElement("div", { className: "grid grid-4" },
    cat.productos.map((p) => /*#__PURE__*/React.createElement("div", { className: 'prod-card ' + (p.agotado || cocinaCerradaCat ? 'agotado' : ''), key: p.id }, /*#__PURE__*/
    React.createElement("div", { className: "prod-img", style: imagenParaCategoria(state, cat.id) ? { backgroundImage: 'url(' + imagenParaCategoria(state, cat.id) + ')', backgroundSize: 'cover', backgroundPosition: 'center' } : {} }, !imagenParaCategoria(state, cat.id) && EMOJI[cat.id],
    p.agotado && /*#__PURE__*/React.createElement("div", { className: "agotado-badge" }, "AGOTADO"),
    !p.agotado && cocinaCerradaCat && /*#__PURE__*/React.createElement("div", { className: "agotado-badge" }, "COCINA CERRADA")
    ), /*#__PURE__*/
    React.createElement("div", { className: "prod-body" }, /*#__PURE__*/
    React.createElement("div", { className: "prod-name" }, p.nombre), /*#__PURE__*/
    React.createElement("div", { className: "prod-price" }, p.pendiente ? 'Precio pendiente' : p.variantes.map((v) => v.nombre + ': ' + money(v.precio)).join(' · ')),
    cat.sabores && cat.sabores.length > 0 && /*#__PURE__*/React.createElement("div", { style: { marginTop: 6 } }, cat.sabores.slice(0, 4).map((s) => /*#__PURE__*/React.createElement("span", { className: "chip", key: s }, s)), cat.sabores.length > 4 && /*#__PURE__*/React.createElement("span", { className: "chip" }, "+", cat.sabores.length - 4)),
    cat.tipo === 'comida' && tiempoPreparacion(p.nombre) && /*#__PURE__*/React.createElement("div", { className: "small", style: { marginTop: 6 } }, "\u23F1\uFE0F Tiempo de preparaci\xF3n: ", /*#__PURE__*/React.createElement("strong", null, tiempoPreparacion(p.nombre))),
    cat.tipo !== 'comida' && tiempoPreparacionBebida(cat.id) && /*#__PURE__*/React.createElement("div", { className: "small", style: { marginTop: 6 } }, "\u23F1\uFE0F Tiempo de preparaci\xF3n: ", /*#__PURE__*/React.createElement("strong", null, tiempoPreparacionBebida(cat.id))),
    p.agotado && /*#__PURE__*/React.createElement("div", { className: "tag danger", style: { marginTop: 6 } }, "\uD83D\uDD34 Agotado por el momento"),
    !p.agotado && cocinaCerradaCat && /*#__PURE__*/React.createElement("div", { className: "tag danger", style: { marginTop: 6 } }, "\uD83C\uDF73 Cocina cerrada \u2014 disponible desde las ", horaTexto12(cocinaHorarioActual(state).horaApertura)),
    !p.pendiente && !p.agotado && !cocinaCerradaCat && /*#__PURE__*/React.createElement(PedirBoton, { cat: cat, producto: p }),
    (p.agotado || cocinaCerradaCat) && /*#__PURE__*/React.createElement("button", { className: "btn btn-ghost btn-sm", style: { marginTop: 10, width: '100%' }, disabled: true }, "No disponible")
    )
    ))
    )
    );}), /*#__PURE__*/
  React.createElement(ReelsSection, { onSubir: () => setTab('videos') })
  ),

  tab === 'eventos' && /*#__PURE__*/React.createElement(EventosCliente, null),
  tab === 'conocenos' && /*#__PURE__*/React.createElement(ConocenosCliente, null),
  tab === 'videos' && /*#__PURE__*/React.createElement(ClienteVideos, null),
  tab === 'cuenta' && /*#__PURE__*/React.createElement("div", { className: "section" },
  currentCustomer ? /*#__PURE__*/React.createElement(ClienteCuenta, null) : /*#__PURE__*/React.createElement(LoginUnico, null)
  ), /*#__PURE__*/

  React.createElement("div", { className: "footer-cta" }, /*#__PURE__*/
  React.createElement("h2", { style: { fontSize: 34, marginBottom: 8 } }, "\xBFListo para tu pr\xF3xima michelada?"), /*#__PURE__*/
  React.createElement("p", { className: "small", style: { color: '#c9c4b8' } }, "El Rey \xB7 Bar de micheladas y bebidas")
  )
  );
}

function EventosCliente() {
  const { state, pushTo, toast, currentCustomer } = useStore();
  const [form, setForm] = useState({ nombre: '', telefono: '', fecha: '', hora: '', ubicacion: '', personas: 20 });
  const [items, setItems] = useState([]); // {id, bebidaId, nombreLibre, sabor, cantidad}
  const [otraNombre, setOtraNombre] = useState('');
  const [otraCantidad, setOtraCantidad] = useState(1);
  const bebidasActivas = state.bebidasEvento.filter((b) => b.activo);
  const misSolicitudes = state.eventRequests.filter((r) => r.nombre === form.nombre && form.nombre);

  function setCantidad(bebidaId, cantidad) {
    setItems((prev) => {
      const existe = prev.find((i) => i.bebidaId === bebidaId);
      if (cantidad <= 0) return prev.filter((i) => i.bebidaId !== bebidaId);
      if (existe) return prev.map((i) => i.bebidaId === bebidaId ? { ...i, cantidad } : i);
      return [...prev, { id: uid('item'), bebidaId, sabor: '', cantidad }];
    });
  }
  function setSabor(bebidaId, sabor) {
    setItems((prev) => prev.map((i) => i.bebidaId === bebidaId ? { ...i, sabor } : i));
  }
  function agregarOtra() {
    if (!otraNombre.trim() || otraCantidad <= 0) {toast('Escribe el nombre y la cantidad de la bebida');return;}
    setItems((prev) => [...prev, { id: uid('item'), bebidaId: null, nombreLibre: otraNombre.trim(), sabor: '', cantidad: Number(otraCantidad) }]);
    setOtraNombre('');setOtraCantidad(1);
  }
  function quitarItem(id) {setItems((prev) => prev.filter((i) => i.id !== id));}

  const itemsConPrecio = items.map((i) => {
    const beb = i.bebidaId ? state.bebidasEvento.find((b) => b.id === i.bebidaId) : null;
    const precioRef = beb ? beb.precio_referencia : 0;
    return { ...i, nombre: beb ? beb.nombre : i.nombreLibre, precioUnitRef: precioRef, subtotal: precioRef * i.cantidad, aceptaSabor: beb ? beb.acepta_sabor : false };
  });
  const totalBebidas = itemsConPrecio.reduce((a, i) => a + i.cantidad, 0);
  const totalEstimado = itemsConPrecio.reduce((a, i) => a + i.subtotal, 0);
  const promedioPorPersona = form.personas > 0 ? (totalBebidas / form.personas).toFixed(1) : '—';

  function enviar() {
    if (!form.nombre || !form.telefono || !form.fecha) {toast('Completa nombre, teléfono y fecha');return;}
    if (itemsConPrecio.filter((i) => i.cantidad > 0).length === 0) {toast('Agrega al menos una bebida con cantidad mayor a cero');return;}
    pushTo('eventRequests', {
      id: uid('req'), ...form,
      items: itemsConPrecio.map((i) => ({ id: i.id, bebidaId: i.bebidaId || null, nombreLibre: i.nombreLibre || null, sabor: i.sabor || null, cantidad: i.cantidad, precioUnitarioRef: i.precioUnitRef, precioUnitarioFinal: null })),
      totalEstimado, totalCotizado: null, anticipoPct: null, anticipoMonto: null, folio: null,
      clienteEmail: currentCustomer ? currentCustomer.email : '', estado: 'pendiente', creadaEn: todayISO()
    });
    toast('📩 Solicitud de evento enviada. El administrador se pondrá en contacto contigo al ' + form.telefono + ' para confirmar los detalles y cotizar.');
    setForm({ nombre: '', telefono: '', fecha: '', hora: '', ubicacion: '', personas: 20 });setItems([]);
  }
  return /*#__PURE__*/React.createElement("div", { className: "section" }, /*#__PURE__*/
  React.createElement("div", { className: "section-head" }, /*#__PURE__*/React.createElement("div", { className: "section-eyebrow" }, "Eventos"), /*#__PURE__*/React.createElement("h2", { className: "section-title" }, "Contrata El Rey en tu fiesta"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Servicio de ~4 horas. Llevamos mercanc\xEDa y personal. Elige las bebidas que quieres para tu evento \u2014 el administrador revisar\xE1 tu solicitud y te enviar\xE1 una cotizaci\xF3n final.")), /*#__PURE__*/
  React.createElement("div", { className: "alert", style: { marginBottom: 16 } }, "\uD83D\uDCDE Para evitar solicitudes falsas, una vez enviada tu solicitud ", /*#__PURE__*/React.createElement("strong", null, "el administrador te llamar\xE1"), " para agendar una breve cita en el local, confirmar los detalles y el anticipo antes de dar por hecha la reservaci\xF3n."), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-2" }, /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Solicitar evento"), /*#__PURE__*/
  React.createElement("div", { className: "grid", style: { gap: 10 } }, /*#__PURE__*/
  React.createElement(Field, { label: "Nombre completo" }, /*#__PURE__*/React.createElement("input", { value: form.nombre, onChange: (e) => setForm({ ...form, nombre: e.target.value }) })), /*#__PURE__*/
  React.createElement(Field, { label: "Tel\xE9fono de contacto" }, /*#__PURE__*/React.createElement("input", { type: "tel", placeholder: "Para que el administrador te llame y confirme la cita", value: form.telefono, onChange: (e) => setForm({ ...form, telefono: e.target.value }) })), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-2" }, /*#__PURE__*/
  React.createElement(Field, { label: "Fecha" }, /*#__PURE__*/React.createElement("input", { type: "date", value: form.fecha, onChange: (e) => setForm({ ...form, fecha: e.target.value }) })), /*#__PURE__*/
  React.createElement(Field, { label: "Hora" }, /*#__PURE__*/React.createElement("input", { type: "time", value: form.hora, onChange: (e) => setForm({ ...form, hora: e.target.value }) }))
  ), /*#__PURE__*/
  React.createElement(Field, { label: "Ubicaci\xF3n" }, /*#__PURE__*/React.createElement("input", { value: form.ubicacion, onChange: (e) => setForm({ ...form, ubicacion: e.target.value }) })), /*#__PURE__*/
  React.createElement(Field, { label: "N\xFAmero de personas" }, /*#__PURE__*/React.createElement("input", { type: "number", value: form.personas, onChange: (e) => setForm({ ...form, personas: Number(e.target.value) }) })), /*#__PURE__*/

  React.createElement("div", { style: { borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 4 } }, /*#__PURE__*/
  React.createElement("div", { className: "small", style: { fontWeight: 700, marginBottom: 8 } }, "Bebidas para tu evento"),
  bebidasActivas.map((b) => {
    const item = items.find((i) => i.bebidaId === b.id);
    return /*#__PURE__*/React.createElement("div", { key: b.id, className: "card", style: { marginBottom: 8, background: 'var(--bg-soft)' } }, /*#__PURE__*/
    React.createElement("div", { className: "flexrow" }, /*#__PURE__*/React.createElement("strong", null, b.nombre), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", { className: "small" }, money(b.precio_referencia), " c/u (ref.)")), /*#__PURE__*/
    React.createElement("div", { className: "flexrow", style: { marginTop: 6 } }, /*#__PURE__*/
    React.createElement(Field, { label: "Cantidad" }, /*#__PURE__*/React.createElement("input", { type: "number", min: "0", style: { maxWidth: 90 }, value: item ? item.cantidad : 0, onChange: (e) => setCantidad(b.id, Number(e.target.value) || 0) })),
    b.acepta_sabor && item && item.cantidad > 0 && /*#__PURE__*/React.createElement(Field, { label: "Sabor" }, /*#__PURE__*/React.createElement("select", { value: item.sabor || '', onChange: (e) => setSabor(b.id, e.target.value) }, /*#__PURE__*/
    React.createElement("option", { value: "" }, "Sin especificar"),
    SABORES_EVENTO.map((s) => /*#__PURE__*/React.createElement("option", { key: s, value: s }, s))
    ))
    )
    );
  }), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { background: 'var(--bg-soft)' } }, /*#__PURE__*/
  React.createElement("div", { className: "small", style: { fontWeight: 700, marginBottom: 6 } }, "\xBFNo est\xE1 en la lista? Otra bebida"), /*#__PURE__*/
  React.createElement("div", { className: "flexrow" }, /*#__PURE__*/
  React.createElement("input", { placeholder: "Nombre de la bebida", value: otraNombre, onChange: (e) => setOtraNombre(e.target.value), style: { flex: 1 } }), /*#__PURE__*/
  React.createElement("input", { type: "number", min: "1", style: { maxWidth: 80 }, value: otraCantidad, onChange: (e) => setOtraCantidad(Number(e.target.value) || 1) }), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: agregarOtra }, "+ Agregar")
  )
  ),
  itemsConPrecio.filter((i) => i.bebidaId === null).length > 0 && /*#__PURE__*/React.createElement("div", { style: { marginTop: 8 } },
  itemsConPrecio.filter((i) => i.bebidaId === null).map((i) => /*#__PURE__*/React.createElement("div", { key: i.id, className: "flexrow small", style: { marginBottom: 4 } }, /*#__PURE__*/
  React.createElement("span", null, i.nombre, " \xD7 ", i.cantidad, " (sin precio de referencia, se cotiza manualmente)"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => quitarItem(i.id) }, "Quitar")
  ))
  )
  ), /*#__PURE__*/

  React.createElement("div", { className: "card", style: { background: 'var(--bg-soft)' } }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow" }, /*#__PURE__*/React.createElement("span", { className: "small" }, "Total estimado"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("strong", { style: { fontSize: 18 } }, money(totalEstimado))), /*#__PURE__*/
  React.createElement("div", { className: "tag warn", style: { marginTop: 6 } }, "\u26A0\uFE0F Sujeto a cotizaci\xF3n \u2014 el administrador confirmar\xE1 el precio final"), /*#__PURE__*/
  React.createElement("div", { className: "small", style: { marginTop: 8 } }, "\uD83E\uDD64 ", totalBebidas, " bebida(s) en total ", form.personas > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, "\u2014 aprox. ", /*#__PURE__*/React.createElement("strong", null, promedioPorPersona), " bebidas por persona (referencia habitual: 2 a 3 por persona)"))
  ), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", onClick: enviar }, "Enviar solicitud")
  )
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Mis eventos"),
  misSolicitudes.length === 0 && /*#__PURE__*/React.createElement("p", { className: "small" }, "Escribe tu nombre en el formulario para ver tus solicitudes (seg\xFAn los datos mock), o revisa tu perfil si ya tienes una aprobada."),
  misSolicitudes.map((ev) => /*#__PURE__*/React.createElement(EventoClienteCard, { key: ev.id, ev: ev }))
  )
  )
  );
}

function EventoClienteCard({ ev }) {
  const { state, updateItem, toast } = useStore();
  const dias = ev.fecha ? diasParaEvento(ev.fecha) : null;
  const alerta = dias !== null && dias <= 5 && dias >= 0;
  const [comprobante, setComprobante] = useState(null);
  const totalMostrado = ev.estado === 'cotizada' || ev.estado === 'aprobada' ? ev.totalCotizado : null;
  const pct = ev.anticipoPct || 50;
  const montoAnticipo = ev.anticipoMonto || (totalMostrado ? Math.round(totalMostrado * pct / 100) : 0);
  const montoRestante = totalMostrado ? totalMostrado - montoAnticipo : 0;

  function enviarAnticipo() {
    if (!comprobante) {toast('Adjunta tu comprobante de depósito primero.');return;}
    updateItem('eventRequests', ev.id, { anticipoComprobante: comprobante, anticipoEnviado: true });
    const tk = state.tickets.find((t) => t.folio === ev.folio);
    if (tk) updateItem('tickets', tk.id, { estadoPago: 'Transferencia pendiente de verificar', metodoPago: 'Transferencia', comprobante, total: montoAnticipo });
    toast('📎 Comprobante de anticipo enviado. El administrador verificará tu pago.');
  }
  return /*#__PURE__*/React.createElement("div", { className: "card", style: { marginBottom: 10, background: 'var(--bg-soft)' } }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow" }, /*#__PURE__*/React.createElement("strong", null, ev.fecha, " \xB7 ", ev.ubicacion), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/
  React.createElement("span", { className: 'tag ' + (ev.estado === 'rechazada' ? 'danger' : ev.estado === 'aprobada' ? 'ok' : ev.estado === 'cotizada' ? 'info' : 'warn') },
  ev.estado === 'rechazada' ? '🔴 Rechazada' : ev.estado === 'aprobada' ? '🟢 Aprobada' : ev.estado === 'cotizada' ? '💬 Cotizada' : '🟡 Pendiente de revisión'
  )
  ),
  ev.estado === 'rechazada' && /*#__PURE__*/React.createElement("div", { className: "alert danger", style: { marginTop: 8 } }, "Esta solicitud fue rechazada. Contacta al negocio si tienes dudas."), /*#__PURE__*/
  React.createElement("div", { className: "small", style: { margin: '6px 0' } },
  (ev.items || []).map((i) => /*#__PURE__*/React.createElement("div", { key: i.id }, i.nombreLibre || state.bebidasEvento.find((b) => b.id === i.bebidaId)?.nombre || 'Bebida', i.sabor ? ' (' + i.sabor + ')' : '', " \xD7 ", i.cantidad))
  ),
  ev.estado === 'pendiente' && /*#__PURE__*/React.createElement("div", { className: "small" }, "Total estimado: ", /*#__PURE__*/React.createElement("strong", null, money(ev.totalEstimado)), " ", /*#__PURE__*/React.createElement("span", { className: "tag warn", style: { marginLeft: 6 } }, "sujeto a cotizaci\xF3n")),
  totalMostrado !== null && /*#__PURE__*/React.createElement("div", { style: { fontWeight: 800, fontSize: 18 } }, "Total cotizado: ", money(totalMostrado)),
  ev.folio && /*#__PURE__*/React.createElement("div", { className: "small", style: { marginTop: 4 } }, "\uD83C\uDFAB Folio: ", /*#__PURE__*/React.createElement("strong", null, ev.folio)),

  ev.estado === 'aprobada' && !ev.anticipoPagado && /*#__PURE__*/React.createElement("div", { className: "card", style: { marginTop: 10, background: 'var(--panel)' } }, /*#__PURE__*/
  React.createElement("div", { className: "small", style: { fontWeight: 700, marginBottom: 6 } }, "Deposita tu anticipo (", money(montoAnticipo), ") a esta cuenta:"), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Titular:"), " ", state.transferAccount.titular), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Banco:"), " ", state.transferAccount.banco), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "CLABE:"), " ", state.transferAccount.clabe), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "N\xFAmero de cuenta:"), " ", state.transferAccount.cuenta), /*#__PURE__*/
  React.createElement("div", { className: "alert", style: { marginTop: 8, background: 'rgba(47,174,78,.12)', borderColor: 'var(--ok)' } }, "\uD83C\uDF89 En cuanto confirmemos tu anticipo, tu evento queda asegurado en la agenda. Restante: ", /*#__PURE__*/
  React.createElement("strong", null, money(montoRestante)), "."
  ),
  !ev.anticipoEnviado ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/
  React.createElement("div", { style: { marginTop: 8 } }, /*#__PURE__*/React.createElement("input", { type: "file", accept: "image/*,.pdf", onChange: (e) => setComprobante(e.target.files[0]?.name || null) })), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary btn-sm", style: { marginTop: 8 }, disabled: !comprobante, onClick: enviarAnticipo }, "Ya deposit\xE9 mi anticipo")
  ) : /*#__PURE__*/React.createElement("div", { className: "tag warn", style: { marginTop: 8 } }, "\uD83D\uDFE1 Comprobante enviado \u2014 el administrador lo est\xE1 verificando")
  ),
  ev.estado === 'aprobada' && dias !== null && /*#__PURE__*/React.createElement("div", { className: 'alert ' + (alerta ? 'danger' : ''), style: { marginTop: 8 } }, "\uD83D\uDCC5 Faltan ", /*#__PURE__*/React.createElement("strong", null, dias), " d\xEDas para el evento. ", alerta && '¡Ya casi es la fecha!'),
  ev.estado === 'aprobada' && /*#__PURE__*/React.createElement("div", { className: "small", style: { marginTop: 6 } }, "Anticipo: ", ev.anticipoPagado ? '✅ Confirmado' : '🟡 Pendiente de verificar', " \xB7 Restante (", money(montoRestante), "): ", ev.liquidado ? '✅ Cobrado' : '⏳ Se paga el día del evento')
  );
}

function PedirBoton({ cat, producto }) {
  const { state, setState, pushTo, toast, crearFolioYTicket, currentCustomer, notify, allProducts, otorgarCortesia } = useStore();
  const [open, setOpen] = useState(false);
  const [varIdx, setVarIdx] = useState(0);
  const [sabor, setSabor] = useState('');
  const [toppings, setToppings] = useState([]);
  const [piezasTopping1, setPiezasTopping1] = useState(null); // null = repartir parejo por defecto
  const [piezasPersonalizadas, setPiezasPersonalizadas] = useState(''); // para Alitas con "Cantidad personalizada"
  const [cerveza, setCerveza] = useState('');
  const [conAlcohol, setConAlcohol] = useState(true);
  const [cantidad, setCantidad] = useState(1);
  const [entrega, setEntrega] = useState('establecimiento');
  const [aderezo, setAderezo] = useState('si');
  const [modoPago, setModoPago] = useState('ahora');
  const [pago, setPago] = useState('efectivo');
  const [recibido, setRecibido] = useState('');
  const [comprobante, setComprobante] = useState(null);
  const [enviado, setEnviado] = useState(false);
  const [cuponAplicado, setCuponAplicado] = useState(false);
  const varianteBase = producto.variantes[varIdx];
  const variante = producto.requiereAlitasCombo ? varianteEfectivaAlitas(varianteBase, piezasPersonalizadas) : varianteBase;
  const subtotal = variante ? variante.precio * cantidad : 0;
  const esFamiliar = currentCustomer && state.familiares.includes(currentCustomer.email);
  const codigoDelMes = cuponDelMes();
  const cuponDisponible = esFamiliar && cuponEnHorario(currentCustomer?.email);
  const schedInfo = currentCustomer ? COUPON_SCHEDULES[currentCustomer.email] : null;
  const descuentoCupon = cuponAplicado && cuponDisponible ? Math.round(subtotal * 0.10) : 0;
  const esComida = cat.tipo === 'comida';
  // --- Promoción de cumpleaños (sección: Promoción de cumpleaños activable por mes) ---
  const cumpleanosPromo = state.cumpleanosPromo;
  const esCumpleanosCliente = !!(cumpleanosPromo && cumpleanosPromo.activa && currentCustomer && esMesDeCumpleanos(currentCustomer.cumpleanos));
  const descuentoCumple = esCumpleanosCliente && cumpleanosPromo.beneficioTipo === 'descuento' ? Math.round(subtotal * ((cumpleanosPromo.descuentoPct || 0) / 100)) : 0;
  const descuento = descuentoCupon + descuentoCumple;
  const total = subtotal - descuento;
  const cambio = pago === 'efectivo' && recibido ? Math.max(0, Number(recibido) - total) : 0;
  const tiempoPrep = esComida ? minutosPrepBase(state, cat.nombre, producto.nombre, variante ? variante.nombre : '') + ' min' : tiempoPreparacionBebida(cat.id);
  // --- Horario especial de cierre de cocina/establecimiento (sección: Horario de cierre por temporada) ---
  const horariosCierre = state.horariosCierre;
  const cocinaCerrada = !cocinaEfectivamenteAbierta(state);
  const establecimientoCerrado = establecimientoCerradoPorHorario(horariosCierre);
  const negocioCerrado = state.negocioAbierto === false;
  const pedidoBloqueado = negocioCerrado || establecimientoCerrado || esComida && cocinaCerrada;

  // Si el cupón ya estaba marcado pero el horario ya no es válido, desmarcarlo automáticamente
  useEffect(() => {if (!cuponDisponible && cuponAplicado) setCuponAplicado(false);}, [cuponDisponible]);

  // Calcula qué bebida de cortesía corresponde según la promoción de temporada activa: la misma que se
  // acaba de comprar (modo 'mismo'), o la bebida fija que definió el Administrador (modo 'fija').
  function bebidaDeCortesiaPorTemporada(nombreCompleto) {
    const promo = state.cortesiaPromo;
    if (!promo || !promo.activa) return null;
    if (promo.modo === 'fija') {
      const fija = allProducts.find((p) => p.id === promo.bebidaFijaId);
      return fija ? fija.nombre : null;
    }
    return nombreCompleto;
  }
  // Calcula la bebida de regalo de cumpleaños (si el beneficio definido por el Admin es tipo "bebida").
  function bebidaDeCumpleanos(nombreCompleto) {
    if (!cumpleanosPromo || cumpleanosPromo.beneficioTipo !== 'bebida') return null;
    const elegida = allProducts.find((p) => p.id === cumpleanosPromo.bebidaId);
    return elegida ? elegida.nombre : nombreCompleto;
  }

  function confirmarPedido() {
    if (pedidoBloqueado) {toast(negocioCerrado ? '🔒 El negocio está cerrado por hoy, vuelve mañana.' : establecimientoCerrado ? '🌙 El establecimiento está cerrando — no se aceptan más pedidos.' : '🍳 Cocina cerrada — disponible desde las ' + horaTexto12(cocinaHorarioActual(state).horaApertura) + '.');return;}
    if (producto.requiereCerveza && !cerveza) {toast('Selecciona de qué cerveza quieres tu michelada');return;}
    if (producto.requiereAlitasCombo) {
      if (varianteBase && varianteBase.personalizada && (Number(piezasPersonalizadas) || 0) <= 0) {toast('Escribe cuántas piezas de alitas quieres en total.');return;}
      if (toppings.length === 0) {toast('Elige al menos 1 sabor para tus alitas (máximo 2).');return;}
      if (toppings.some((t) => saborEstaAgotado(state, cat.id, t))) {toast('🚫 Uno de los sabores elegidos se agotó justo ahora — revisa tu selección.');return;}
    } else if (sabor && saborEstaAgotado(state, cat.id, sabor)) {toast('🚫 Ese sabor se agotó justo ahora — elige otro.');return;}
    if (modoPago === 'ahora' && pago === 'transferencia' && !enviado) {toast('Adjunta tu comprobante y confirma la transferencia primero.');return;}
    const totalPiezasAlitas = producto.requiereAlitasCombo ? piezasDeVariante(variante.nombre) * cantidad : 0;
    const piezas1cliente = piezasTopping1 !== null ? piezasTopping1 : Math.ceil(totalPiezasAlitas / 2);
    const piezas2cliente = totalPiezasAlitas - piezas1cliente;
    const saborFinal = producto.requiereAlitasCombo ?
    toppings.length === 2 ? piezas1cliente + ' ' + toppings[0] + ' + ' + piezas2cliente + ' ' + toppings[1] : toppings.join(' + ') :
    sabor;
    const nombreCompleto = producto.requiereAlitasCombo ?
    producto.nombre + ' ' + variante.nombre + (saborFinal ? ' — ' + saborFinal : '') :
    producto.nombre + ' (' + variante.nombre + (cerveza ? ', ' + cerveza : '') + (saborFinal ? ', ' + saborFinal : '') + ')';
    const folio = crearFolioYTicket('PED', {
      clienteNombre: currentCustomer ? currentCustomer.nombre : 'Cliente mostrador',
      clienteEmail: currentCustomer ? currentCustomer.email : '',
      tipoPedido: entrega === 'establecimiento' ? 'Consumo en establecimiento' : entrega === 'llevar' ? 'Para llevar' : 'A domicilio',
      items: [{ nombre: nombreCompleto, cantidad, total: subtotal }],
      subtotal, descuento, total,
      metodoPago: modoPago === 'despues' ? 'Cuenta abierta' : pago === 'efectivo' ? 'Efectivo' : 'Transferencia',
      pagoRecibido: modoPago === 'ahora' && pago === 'efectivo' ? Number(recibido) || total : undefined,
      cambio: modoPago === 'ahora' && pago === 'efectivo' ? cambio : undefined,
      estadoPago: modoPago === 'despues' ? 'Cuenta abierta (pendiente de pago)' : pago === 'efectivo' ? 'Pagado (cambio entregado)' : 'Transferencia pendiente de verificar',
      comprobante: comprobante, estadoPedido: 'Pedido recibido'
    });
    const ventaId = uid('sale');
    pushTo('sales', { id: ventaId, fecha: todayISO(), hora: nowTime(), mesero: currentCustomer ? currentCustomer.nombre : 'Cliente (autoservicio)', pago: modoPago === 'despues' ? 'cuenta_abierta' : pago,
      producto: producto.nombre, categoria: cat.nombre, variante: variante.nombre, sabor: saborFinal || null, cerveza: cerveza || null, conAlcohol: cat.conAlcoholToggle ? conAlcohol : null,
      cantidad, precioUnit: variante.precio, total, descuento, cambio: modoPago === 'ahora' && pago === 'efectivo' ? cambio : 0, entrega, folio,
      clienteEmail: currentCustomer ? currentCustomer.email : '', clienteNombre: currentCustomer ? currentCustomer.nombre : '',
      aderezo: esComida ? aderezo === 'si' : null, estadoPedido: 'Pedido recibido',
      estadoPago: modoPago === 'despues' ? 'cuenta_abierta' : pago === 'efectivo' ? 'confirmado' : 'pendiente' });

    // --- Cuenta abierta (pagar después): se acumula en la cuenta abierta del cliente en vez de cobrarse ahora ---
    if (modoPago === 'despues' && currentCustomer) {
      agregarACuentaAbierta(setState, currentCustomer, { ventaId, nombre: nombreCompleto, cantidad, total, hora: nowTime() });
    }

    // --- Promoción de bebida de cortesía por temporada (sección 1) ---
    if (!esComida && currentCustomer) {
      const bebidaCortesia = bebidaDeCortesiaPorTemporada(nombreCompleto);
      if (bebidaCortesia) {
        otorgarCortesia({ tipo: 'promo_temporada', clienteNombre: currentCustomer.nombre, clienteEmail: currentCustomer.email, bebida: bebidaCortesia, ventaId, motivo: 'Promoción de cortesía activa' });
        toast('🎁 ¡Tienes una cortesía! El Cantinero preparará tu ' + bebidaCortesia + ' de regalo.');
      }
    }
    // --- Promoción de cumpleaños (sección 2) ---
    if (esCumpleanosCliente) {
      toast('🎂 ¡Feliz cumpleaños, ' + currentCustomer.nombre.split(' ')[0] + '! Tu beneficio de cumpleaños ya fue aplicado.');
      if (cumpleanosPromo.beneficioTipo === 'bebida') {
        const bebidaCumple = bebidaDeCumpleanos(nombreCompleto);
        if (bebidaCumple) {
          otorgarCortesia({ tipo: 'cumpleanos', clienteNombre: currentCustomer.nombre, clienteEmail: currentCustomer.email, bebida: bebidaCumple, ventaId, motivo: 'Regalo de cumpleaños' });
        }
      }
    }

    toast(modoPago === 'despues' ? '🧾 Pedido agregado a tu cuenta abierta — folio ' + folio + (tiempoPrep ? ' · Tiempo estimado: ' + tiempoPrep : '') : '🧾 Pedido registrado — folio ' + folio + (tiempoPrep ? ' · Tiempo estimado: ' + tiempoPrep : ''));
    setOpen(false);setEnviado(false);setComprobante(null);setRecibido('');setCuponAplicado(false);
  }

  function handlePedir() {
    if (!currentCustomer) {
      toast('⚠️ Debes iniciar sesión o crear una cuenta para realizar un pedido.');
      return;
    }
    if (negocioCerrado) {toast('🔒 El negocio está cerrado por hoy, vuelve mañana.');return;}
    if (establecimientoCerrado) {toast('🌙 El establecimiento está cerrando — no se aceptan más pedidos por hoy.');return;}
    if (esComida && cocinaCerrada) {toast('🍳 Cocina cerrada — disponible desde las ' + horaTexto12(cocinaHorarioActual(state).horaApertura) + '.');return;}
    setOpen(true);
  }

  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary btn-sm", style: { marginTop: 10, width: '100%' }, disabled: !!currentCustomer && pedidoBloqueado, onClick: handlePedir },
  !currentCustomer ? '🔒 Iniciar sesión para pedir' : negocioCerrado ? '🔒 Negocio cerrado' : establecimientoCerrado ? '🌙 Cerrado por hoy' : esComida && cocinaCerrada ? '🍳 Cocina cerrada' : 'Pedir'
  ),
  !currentCustomer && /*#__PURE__*/React.createElement("div", { className: "small", style: { marginTop: 4, color: 'var(--ink-dim)', textAlign: 'center' } }, "Necesitas una cuenta para ordenar"),
  currentCustomer && negocioCerrado && /*#__PURE__*/React.createElement("div", { className: "small", style: { marginTop: 4, color: 'var(--danger)', textAlign: 'center' } }, "El negocio est\xE1 cerrado por hoy, vuelve ma\xF1ana."),
  currentCustomer && !negocioCerrado && establecimientoCerrado && /*#__PURE__*/React.createElement("div", { className: "small", style: { marginTop: 4, color: 'var(--danger)', textAlign: 'center' } }, "El establecimiento est\xE1 cerrando por hoy."),
  currentCustomer && !negocioCerrado && !establecimientoCerrado && esComida && cocinaCerrada && /*#__PURE__*/React.createElement("div", { className: "small", style: { marginTop: 4, color: 'var(--warn)', textAlign: 'center' } }, "Cocina cerrada \u2014 disponible desde las ", horaTexto12(cocinaHorarioActual(state).horaApertura), "."),
  open && /*#__PURE__*/React.createElement(Modal, { title: 'Pedir: ' + producto.nombre, onClose: () => setOpen(false) }, /*#__PURE__*/
  React.createElement("div", { className: "grid", style: { gap: 10 } },
  tiempoPrep && /*#__PURE__*/React.createElement("div", { className: "alert" }, "\u23F1\uFE0F Tiempo estimado de preparaci\xF3n: ", /*#__PURE__*/React.createElement("strong", null, tiempoPrep)),
  esCumpleanosCliente && /*#__PURE__*/React.createElement("div", { className: "alert", style: { background: 'rgba(255,90,60,.12)', borderColor: 'var(--neon)' } }, "\uD83C\uDF82 ", /*#__PURE__*/
  React.createElement("div", null, /*#__PURE__*/React.createElement("strong", null, "\xA1Feliz cumplea\xF1os, ", currentCustomer.nombre.split(' ')[0], "!"), " Este mes tienes un beneficio especial:", ' ',
  cumpleanosPromo.beneficioTipo === 'bebida' ? 'una bebida de regalo con tu pedido' : cumpleanosPromo.beneficioTipo === 'descuento' ? cumpleanosPromo.descuentoPct + '% de descuento en tu pedido' : cumpleanosPromo.nota || 'un beneficio especial', " \uD83C\uDF89")
  ),
  !esComida && state.cortesiaPromo && state.cortesiaPromo.activa && /*#__PURE__*/React.createElement("div", { className: "alert", style: { background: 'rgba(200,255,77,.1)', borderColor: 'var(--lime)' } }, "\uD83C\uDF81 Hoy hay ", /*#__PURE__*/
  React.createElement("strong", null, "promoci\xF3n de cortes\xEDa"), ": al confirmar tu pedido, el Cantinero preparar\xE1 una bebida de regalo para ti."
  ), /*#__PURE__*/
  React.createElement(Field, { label: "Presentaci\xF3n / variante" }, /*#__PURE__*/React.createElement("select", { value: varIdx, onChange: (e) => {setVarIdx(Number(e.target.value));setPiezasPersonalizadas('');} }, producto.variantes.map((v, i) => /*#__PURE__*/React.createElement("option", { key: i, value: i }, v.personalizada ? v.nombre + ' (tú indicas cuántas)' : v.nombre + ' — ' + money(v.precio))))),
  varianteBase && varianteBase.personalizada && /*#__PURE__*/React.createElement(Field, { label: '¿Cuántas piezas en total? ($' + PRECIO_POR_PIEZA_ALITA + '/pza)' }, /*#__PURE__*/
  React.createElement("input", { type: "number", min: "1", value: piezasPersonalizadas, onChange: (e) => setPiezasPersonalizadas(e.target.value), placeholder: "Ej. 15" }),
  Number(piezasPersonalizadas) > 0 && /*#__PURE__*/React.createElement("div", { className: "small", style: { marginTop: 4 } }, "Precio: ", money(Number(piezasPersonalizadas) * PRECIO_POR_PIEZA_ALITA))
  ),
  producto.requiereCerveza && cat.cervezas && /*#__PURE__*/React.createElement(Field, { label: "\xBFDe qu\xE9 cerveza la quieres?" }, /*#__PURE__*/React.createElement("select", { value: cerveza, onChange: (e) => setCerveza(e.target.value) }, /*#__PURE__*/
  React.createElement("option", { value: "" }, "Selecciona\u2026"),
  cat.cervezas.map((c) => /*#__PURE__*/React.createElement("option", { key: c, value: c }, c))
  )),
  cat.sabores && cat.sabores.length > 0 && !producto.requiereAlitasCombo && /*#__PURE__*/React.createElement(Field, { label: "Sabor (sin costo extra)" }, /*#__PURE__*/React.createElement("select", { value: sabor, onChange: (e) => setSabor(e.target.value) }, /*#__PURE__*/React.createElement("option", { value: "" }, "Sin especificar"), cat.sabores.map((s) => {const agotado = saborEstaAgotado(state, cat.id, s);return /*#__PURE__*/React.createElement("option", { key: s, value: s, disabled: agotado }, agotado ? '🚫 ' + s + ' (agotado)' : s);}))),
  producto.requiereAlitasCombo && cat.sabores && cat.sabores.length > 0 && /*#__PURE__*/React.createElement(Field, { label: 'Sabor(es) — elige hasta 2 (' + toppings.length + '/2)' }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { flexWrap: 'wrap', gap: 8 } },
  cat.sabores.map((s) => {
    const agotado = saborEstaAgotado(state, cat.id, s);
    const marcado = toppings.includes(s);
    return /*#__PURE__*/React.createElement("button", { type: "button", key: s, className: 'btn btn-sm ' + (marcado ? 'btn-primary' : 'btn-secondary'),
      disabled: agotado || !marcado && toppings.length >= 2,
      onClick: () => {setPiezasTopping1(null);marcado ? setToppings(toppings.filter((t) => t !== s)) : setToppings([...toppings, s]);} },
    agotado ? '🚫 ' + s : s
    );
  })
  ),
  toppings.length < 2 && /*#__PURE__*/React.createElement("div", { className: "small", style: { marginTop: 6 } }, toppings.length === 0 ? 'Elige al menos 1 sabor.' : 'Todas las piezas serán de ' + toppings[0] + '. Puedes elegir un 2º sabor para combinar.'),
  toppings.length === 2 && /*#__PURE__*/React.createElement("div", { style: { marginTop: 10 } }, /*#__PURE__*/
  React.createElement("div", { className: "small", style: { marginBottom: 6 } }, "\xBFCu\xE1ntas piezas de cada sabor? (de ", piezasDeVariante(variante.nombre) * cantidad, " piezas en total)"), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-2" }, /*#__PURE__*/
  React.createElement(Field, { label: toppings[0] + ' (piezas)' }, /*#__PURE__*/
  React.createElement("input", { type: "number", min: "0", max: piezasDeVariante(variante.nombre) * cantidad,
    value: piezasTopping1 !== null ? piezasTopping1 : Math.ceil(piezasDeVariante(variante.nombre) * cantidad / 2),
    onChange: (e) => {const tot = piezasDeVariante(variante.nombre) * cantidad;setPiezasTopping1(Math.max(0, Math.min(tot, Number(e.target.value) || 0)));} })
  ), /*#__PURE__*/
  React.createElement(Field, { label: toppings[1] + ' (piezas)' }, /*#__PURE__*/
  React.createElement("input", { type: "number", value: piezasDeVariante(variante.nombre) * cantidad - (piezasTopping1 !== null ? piezasTopping1 : Math.ceil(piezasDeVariante(variante.nombre) * cantidad / 2)), readOnly: true })
  )
  )
  )
  ),
  cat.conAlcoholToggle && /*#__PURE__*/React.createElement(Field, { label: "Preparaci\xF3n" }, /*#__PURE__*/React.createElement("select", { value: conAlcohol ? 'con' : 'sin', onChange: (e) => setConAlcohol(e.target.value === 'con') }, /*#__PURE__*/React.createElement("option", { value: "con" }, "Con alcohol"), /*#__PURE__*/React.createElement("option", { value: "sin" }, "Sin alcohol"))), /*#__PURE__*/
  React.createElement(Field, { label: "Cantidad" }, /*#__PURE__*/React.createElement("input", { type: "number", min: "1", value: cantidad, onChange: (e) => setCantidad(Number(e.target.value) || 1) })), /*#__PURE__*/
  React.createElement(Field, { label: "Tipo de entrega" }, /*#__PURE__*/React.createElement("select", { value: entrega, onChange: (e) => setEntrega(e.target.value) }, /*#__PURE__*/
  React.createElement("option", { value: "establecimiento" }, "Consumo en establecimiento"), /*#__PURE__*/
  React.createElement("option", { value: "llevar" }, "Para llevar"), /*#__PURE__*/
  React.createElement("option", { value: "domicilio" }, "A domicilio")
  )),
  esComida && /*#__PURE__*/React.createElement(Field, { label: "\xBFCon aderezo / complementos?" }, /*#__PURE__*/React.createElement("select", { value: aderezo, onChange: (e) => setAderezo(e.target.value) }, /*#__PURE__*/
  React.createElement("option", { value: "si" }, "S\xED, con aderezo/complementos"), /*#__PURE__*/
  React.createElement("option", { value: "no" }, "No, sin aderezo")
  )),
  esFamiliar && /*#__PURE__*/React.createElement("div", { className: "card", style: { background: 'var(--bg-soft)' } },
  cuponDisponible ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/
  React.createElement("label", { className: "flexrow", style: { cursor: 'pointer' } }, /*#__PURE__*/
  React.createElement("input", { type: "checkbox", style: { width: 'auto' }, checked: cuponAplicado, onChange: (e) => setCuponAplicado(e.target.checked) }), /*#__PURE__*/
  React.createElement("span", null, "\uD83C\uDFF7\uFE0F ", /*#__PURE__*/React.createElement("strong", null, "Agregar mi cup\xF3n de descuento"), " (10% en cualquier producto)")
  ),
  cuponAplicado && /*#__PURE__*/React.createElement("div", { className: "tag ok", style: { marginTop: 6 } }, "\u2705 Cup\xF3n aplicado: -10% (", codigoDelMes, ")")
  ) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { gap: 8 } }, /*#__PURE__*/
  React.createElement("span", { style: { fontSize: 18 } }, "\uD83D\uDD12"), /*#__PURE__*/
  React.createElement("div", null, /*#__PURE__*/
  React.createElement("div", { style: { fontWeight: 700, fontSize: 13 } }, "Cup\xF3n no disponible en este momento"), /*#__PURE__*/
  React.createElement("div", { className: "small", style: { marginTop: 2 } },
  schedInfo ?
  `Tu cupón solo es válido en el horario ${schedInfo.label}. Fuera de ese horario se aplica el precio normal.` :
  'Cupón fuera del horario permitido.'
  )
  )
  )
  )
  ), /*#__PURE__*/
  React.createElement(Field, { label: "\xBFCu\xE1ndo deseas pagar?" }, /*#__PURE__*/React.createElement("select", { value: modoPago, onChange: (e) => setModoPago(e.target.value) }, /*#__PURE__*/
  React.createElement("option", { value: "ahora" }, "Pagar ahora"), /*#__PURE__*/
  React.createElement("option", { value: "despues" }, "Agregar a mi cuenta (pagar despu\xE9s)")
  )),
  modoPago === 'despues' && /*#__PURE__*/React.createElement("div", { className: "alert", style: { background: 'rgba(255,193,7,.1)' } }, "\uD83E\uDDFE Tu pedido se manda a preparar igual. El total se suma a tu ", /*#__PURE__*/React.createElement("strong", null, "cuenta abierta"), " \u2014 podr\xE1s verla y solicitar el pago cuando quieras desde \"Mi cuenta\"."),
  modoPago === 'ahora' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/
  React.createElement(Field, { label: "M\xE9todo de pago" }, /*#__PURE__*/React.createElement("select", { value: pago, onChange: (e) => {setPago(e.target.value);setEnviado(false);} }, /*#__PURE__*/React.createElement("option", { value: "efectivo" }, "Efectivo"), /*#__PURE__*/React.createElement("option", { value: "transferencia" }, "Transferencia"))),
  pago === 'efectivo' && /*#__PURE__*/React.createElement(Field, { label: "\xBFCon cu\xE1nto pagar\xE1?" }, /*#__PURE__*/React.createElement("input", { type: "number", value: recibido, onChange: (e) => setRecibido(e.target.value) })),
  pago === 'transferencia' && /*#__PURE__*/React.createElement("div", { className: "card", style: { background: 'var(--bg-soft)' } }, /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Titular:"), " ", state.transferAccount.titular), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Banco:"), " ", state.transferAccount.banco), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "CLABE:"), " ", state.transferAccount.clabe), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "N\xFAmero de cuenta:"), " ", state.transferAccount.cuenta), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Monto a transferir:"), " ", money(total)),
  !enviado ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/
  React.createElement("div", { style: { marginTop: 8 } }, /*#__PURE__*/React.createElement("input", { type: "file", accept: "image/*,.pdf", onChange: (e) => setComprobante(e.target.files[0]?.name || null) })), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-secondary btn-sm", style: { marginTop: 8 }, disabled: !comprobante, onClick: () => setEnviado(true) }, "Ya realic\xE9 mi transferencia")
  ) : /*#__PURE__*/React.createElement("div", { className: "tag warn", style: { marginTop: 8 } }, "\uD83D\uDFE1 Transferencia pendiente de verificar")
  )
  ), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { display: 'flex', flexDirection: 'column', gap: 4 } }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow small" }, /*#__PURE__*/React.createElement("span", null, "Subtotal"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", null, money(subtotal))),
  descuentoCupon > 0 && /*#__PURE__*/React.createElement("div", { className: "flexrow small" }, /*#__PURE__*/React.createElement("span", null, "Descuento cup\xF3n familiar"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", null, "-", money(descuentoCupon))),
  descuentoCumple > 0 && /*#__PURE__*/React.createElement("div", { className: "flexrow small" }, /*#__PURE__*/React.createElement("span", null, "\uD83C\uDF82 Descuento de cumplea\xF1os"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", null, "-", money(descuentoCumple))), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { justifyContent: 'space-between', alignItems: 'center' } }, /*#__PURE__*/
  React.createElement("div", null, /*#__PURE__*/React.createElement("div", { className: "small" }, "Total"), /*#__PURE__*/React.createElement("div", { style: { fontSize: 20, fontWeight: 800 } }, money(total))),
  modoPago === 'ahora' && pago === 'efectivo' && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", { className: "small" }, "Cambio"), /*#__PURE__*/React.createElement("div", { style: { fontWeight: 800, color: 'var(--ok)' } }, money(cambio)))
  )
  ), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", onClick: confirmarPedido }, modoPago === 'despues' ? 'Agregar a mi cuenta' : 'Confirmar pedido')
  )
  )
  );
}

function ClienteCuenta() {
  const { state, setState, notify, currentCustomer, cerrarSesionCliente, updateItem, toast } = useStore();
  const [tab, setTab] = useState('perfil');
  const [solicitando, setSolicitando] = useState(false);
  const [metodoSolicitud, setMetodoSolicitud] = useState('efectivo');
  const misPedidos = state.sales.filter((s) => s.mesero === currentCustomer.nombre || s.folio && state.tickets.find((t) => t.folio === s.folio && t.clienteEmail === currentCustomer.email));
  const misTickets = state.tickets.filter((t) => t.clienteEmail === currentCustomer.email);
  const misSolicitudes = state.eventRequests.filter((r) => r.nombre === currentCustomer.nombre);
  const misCotizaciones = state.eventRequests.filter((e) => e.nombre === currentCustomer.nombre && e.folio);
  const pendientesTransfer = misTickets.filter((t) => t.estadoPago === 'Transferencia pendiente de verificar').length;
  const miCuenta = (state.cuentasAbiertas || []).find((t) => t.clienteEmail === currentCustomer.email && t.estado !== 'cerrada');
  const cuentasCerradas = (state.cuentasAbiertas || []).filter((t) => t.clienteEmail === currentCustomer.email && t.estado === 'cerrada');

  function solicitarPago() {
    setState((s) => ({ ...s, cuentasAbiertas: s.cuentasAbiertas.map((t) => t.id !== miCuenta.id ? t : { ...t, estado: 'solicitando_pago', metodoPagoSolicitado: metodoSolicitud, horaSolicitud: nowTime() }) }));
    notify({ tipo: 'cuenta_pago_solicitado', clienteNombre: currentCustomer.nombre, total: miCuenta.total, metodoPago: metodoSolicitud });
    toast('✅ Solicitud de pago enviada — el mesero o el Cantinero vendrán a cobrarte');
    setSolicitando(false);
  }

  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { marginBottom: 16 } }, /*#__PURE__*/
  React.createElement("h2", { style: { margin: 0 } }, "\uD83D\uDC64 Mi cuenta"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => {cerrarSesionCliente();toast('Sesión cerrada');} }, "Cerrar sesi\xF3n")
  ), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { marginBottom: 16, flexWrap: 'wrap' } },
  [['perfil', 'Mi perfil'], ['cuentaabierta', 'Cuenta abierta'], ['pedidos', 'Mis pedidos'], ['tickets', 'Mis tickets'], ['solicitudes', 'Solicitudes de eventos'], ['cotizaciones', 'Cotizaciones'], ['pagos', 'Estado de pagos']].map(([k, l]) => /*#__PURE__*/
  React.createElement("button", { key: k, className: 'pill ' + (tab === k ? 'active' : ''), onClick: () => setTab(k) }, l, k === 'pagos' && pendientesTransfer > 0 ? ' (' + pendientesTransfer + ')' : '', k === 'cuentaabierta' && miCuenta ? ' (' + money(miCuenta.total) + ')' : ''))
  ),

  tab === 'perfil' && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement(PerfilCard, { persona: currentCustomer, mostrarCumpleanos: true, onGuardar: (patch) => {updateItem('customers', currentCustomer.id, patch);toast('✅ Perfil actualizado');} }), /*#__PURE__*/
  React.createElement("p", { className: "small", style: { marginTop: 8 } }, "Cuenta creada: ", fmtDate(currentCustomer.creado)),
  state.familiares.includes(currentCustomer.email) && /*#__PURE__*/React.createElement("div", { className: "card", style: { maxWidth: 420, marginTop: 14, background: 'var(--bg-soft)' } }, /*#__PURE__*/
  React.createElement("div", { className: "small", style: { fontWeight: 700, marginBottom: 6 } }, "\uD83C\uDFF7\uFE0F Cup\xF3n familiar (exclusivo)"), /*#__PURE__*/
  React.createElement("div", { style: { fontSize: 26, fontWeight: 800, color: 'var(--neon-2)', fontFamily: 'var(--font-display)' } }, cuponDelMes()), /*#__PURE__*/
  React.createElement("div", { className: "small" }, "10% de descuento en cualquier producto. Al momento de pedir, marca la casilla \"Agregar mi cup\xF3n de descuento familiar\" \u2014 se aplica autom\xE1ticamente, sin necesidad de escribir el c\xF3digo. V\xE1lido solo este mes.")
  )
  ),

  tab === 'cuentaabierta' && /*#__PURE__*/React.createElement("div", null,
  !miCuenta && cuentasCerradas.length === 0 && /*#__PURE__*/React.createElement("p", { className: "small" }, "No tienes una cuenta abierta en este momento. Cuando hagas un pedido, elige \"Agregar a mi cuenta\" en vez de \"Pagar ahora\" para pagar despu\xE9s."),
  miCuenta && /*#__PURE__*/React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Tu cuenta abierta"), /*#__PURE__*/
  React.createElement("table", { style: { marginTop: 8 } }, /*#__PURE__*/React.createElement("tbody", null,
  miCuenta.items.map((i, idx) => /*#__PURE__*/React.createElement("tr", { key: idx }, /*#__PURE__*/React.createElement("td", null, i.nombre, " x", i.cantidad), /*#__PURE__*/React.createElement("td", { style: { textAlign: 'right' } }, money(i.total))))
  )), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { marginTop: 10, fontWeight: 800, fontSize: 18 } }, /*#__PURE__*/React.createElement("span", null, "Total acumulado"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", null, money(miCuenta.total))),
  miCuenta.estado === 'abierta' && !solicitando && /*#__PURE__*/React.createElement("button", { className: "btn btn-primary", style: { marginTop: 12 }, onClick: () => setSolicitando(true) }, "\uD83D\uDCB3 Solicitar pago"),
  miCuenta.estado === 'abierta' && solicitando && /*#__PURE__*/React.createElement("div", { style: { marginTop: 12 } }, /*#__PURE__*/
  React.createElement(Field, { label: "\xBFC\xF3mo vas a pagar?" }, /*#__PURE__*/React.createElement("select", { value: metodoSolicitud, onChange: (e) => setMetodoSolicitud(e.target.value) }, /*#__PURE__*/React.createElement("option", { value: "efectivo" }, "Efectivo"), /*#__PURE__*/React.createElement("option", { value: "transferencia" }, "Transferencia"))), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { gap: 8 } }, /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary btn-sm", onClick: solicitarPago }, "Confirmar solicitud"), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => setSolicitando(false) }, "Cancelar")
  )
  ),
  miCuenta.estado === 'solicitando_pago' && /*#__PURE__*/React.createElement("div", { className: "tag warn", style: { marginTop: 12 } }, "\uD83D\uDFE1 Pago solicitado (", miCuenta.metodoPagoSolicitado === 'efectivo' ? 'Efectivo' : 'Transferencia', ") \u2014 espera a que te cobren.")
  ),
  cuentasCerradas.length > 0 && /*#__PURE__*/React.createElement("div", { style: { marginTop: 16 } }, /*#__PURE__*/
  React.createElement("h3", null, "Cuentas cerradas anteriores"), /*#__PURE__*/
  React.createElement(DataTable, { columns: [{ key: 'fechaApertura', label: 'Fecha' }, { key: 'total', label: 'Total', render: (r) => money(r.total) }, { key: 'folio', label: 'Folio', render: (r) => r.folio || '—' }], rows: [...cuentasCerradas].reverse() })
  )
  ),

  tab === 'pedidos' && /*#__PURE__*/React.createElement("div", null,
  misPedidos.filter((r) => (r.categoria === 'Alitas' || r.categoria === 'Snacks y botanas') && (r.estadoPedido === 'Pedido recibido' || r.estadoPedido === 'En preparación')).map((r) => /*#__PURE__*/
  React.createElement("div", { key: r.id, className: "alert", style: { marginBottom: 10 } }, "\uD83C\uDF57 Tu orden de ", /*#__PURE__*/React.createElement("strong", null, r.producto.toLowerCase(), r.variante ? ' ' + r.variante : ''), " est\xE1 en preparaci\xF3n \u2014 tiempo estimado: ", /*#__PURE__*/React.createElement("strong", null, tiempoEstimadoRealVenta(state, r), " minutos"), ".")
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement(DataTable, { emptyText: "A\xFAn no tienes pedidos.", columns: [
    { key: 'fecha', label: 'Fecha' }, { key: 'hora', label: 'Hora' }, { key: 'producto', label: 'Producto' }, { key: 'folio', label: 'Folio', render: (r) => r.folio || '—' },
    { key: 'tiempo', label: 'Tiempo estimado', render: (r) => r.categoria === 'Alitas' || r.categoria === 'Snacks y botanas' ? r.estadoPedido === 'Listo' || r.estadoPedido === 'Entregado' ? 'Listo' : tiempoEstimadoRealVenta(state, r) + ' min' : tiempoPreparacionBebida(r.categoria) || 'Inmediato' },
    { key: 'estadoPedido', label: 'Estado', render: (r) => /*#__PURE__*/React.createElement("span", { className: 'tag ' + (r.estadoPedido === 'Listo' || r.estadoPedido === 'Entregado' ? 'ok' : r.estadoPedido === 'En preparación' ? 'warn' : 'info') }, r.estadoPedido || 'Pedido recibido') },
    { key: 'total', label: 'Total', render: (r) => money(r.total) }],
    rows: [...misPedidos].reverse() })
  )
  ),

  tab === 'tickets' && /*#__PURE__*/React.createElement("div", null,
  misTickets.length === 0 && /*#__PURE__*/React.createElement("p", { className: "small" }, "A\xFAn no tienes tickets. Se generan autom\xE1ticamente al confirmar una compra, pedido, reservaci\xF3n o evento."),
  [...misTickets].reverse().map((t) => /*#__PURE__*/React.createElement("div", { key: t.id, className: "card", style: { marginBottom: 10 } }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow" }, /*#__PURE__*/React.createElement("strong", null, t.folio), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", { className: "small" }, t.fecha, " ", t.hora)), /*#__PURE__*/
  React.createElement("div", { className: "small" }, t.tipoPedido, " \xB7 ", money(t.total)), /*#__PURE__*/
  React.createElement("div", { style: { marginTop: 8 } }, /*#__PURE__*/React.createElement(TicketViewer, { ticket: t }))
  ))
  ),

  tab === 'solicitudes' && /*#__PURE__*/React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement(DataTable, { emptyText: "Sin solicitudes de evento.", columns: [{ key: 'fecha', label: 'Fecha' }, { key: 'ubicacion', label: 'Ubicación' }, { key: 'bebidas', label: 'Bebidas', render: (r) => (r.items || []).length + ' tipo(s)' }, { key: 'estado', label: 'Estado' }], rows: misSolicitudes })
  ),

  tab === 'cotizaciones' && /*#__PURE__*/React.createElement("div", null,
  misCotizaciones.length === 0 && /*#__PURE__*/React.createElement("p", { className: "small" }, "Sin cotizaciones a\xFAn."),
  misCotizaciones.map((ev) => /*#__PURE__*/React.createElement(EventoClienteCard, { key: ev.id, ev: ev }))
  ),

  tab === 'pagos' && /*#__PURE__*/React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement(DataTable, { emptyText: "Sin pagos registrados.", columns: [
    { key: 'folio', label: 'Folio' }, { key: 'metodoPago', label: 'Método' },
    { key: 'estadoPago', label: 'Estado', render: (r) => /*#__PURE__*/React.createElement("span", { className: 'tag ' + (r.estadoPago === 'Pago confirmado' || r.estadoPago === 'Pagado (cambio entregado)' ? 'ok' : 'warn') }, r.estadoPago) },
    { key: 'total', label: 'Total', render: (r) => money(r.total) }],
    rows: [...misTickets].reverse() })
  )
  );
}

function ClienteVideos() {
  const { state, pushTo, toast, currentCustomer } = useStore();
  const [descripcion, setDescripcion] = useState('');
  const [archivo, setArchivo] = useState(null);
  const [ultimoResultado, setUltimoResultado] = useState(null);
  const aprobados = state.customerVideos.filter((v) => v.estado === 'aprobado');
  const misVideos = currentCustomer ? state.customerVideos.filter((v) => v.email === currentCustomer.email) : [];

  function subir() {
    if (!archivo) {toast('Selecciona un video primero');return;}
    if (!descripcion.trim()) {toast('Describe brevemente qué promociona tu video');return;}
    const aprobado = moderarVideoPromocional(descripcion, archivo.name);
    const url = URL.createObjectURL(archivo);
    const registro = {
      id: uid('cv'), nombre: currentCustomer ? currentCustomer.nombre : 'Cliente anónimo', email: currentCustomer ? currentCustomer.email : '',
      descripcion, name: archivo.name, url, fecha: todayISO(), hora: nowTime(),
      estado: aprobado ? 'aprobado' : 'rechazado'
    };
    pushTo('customerVideos', registro);
    setUltimoResultado(registro);
    if (aprobado) toast('✅ Video aprobado automáticamente y publicado en la galería');else
    toast('❌ Video dado de baja automáticamente: no se detectó contenido promocional del negocio');
    setDescripcion('');setArchivo(null);
  }

  return /*#__PURE__*/React.createElement("div", { className: "section" }, /*#__PURE__*/
  React.createElement("div", { className: "section-head" }, /*#__PURE__*/React.createElement("div", { className: "section-eyebrow" }, "Comunidad"), /*#__PURE__*/React.createElement("h2", { className: "section-title" }, "Sube tu video promocionando El Rey"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Un moderador autom\xE1tico simulado revisa la descripci\xF3n de tu video: si no menciona claramente al negocio (bar, micheladas, bebidas, evento, etc.), se da de baja autom\xE1ticamente y no se publica.")), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-2" }, /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Subir video"), /*#__PURE__*/
  React.createElement("div", { className: "grid", style: { gap: 10 } }, /*#__PURE__*/
  React.createElement(Field, { label: "\xBFQu\xE9 promociona tu video?" }, /*#__PURE__*/React.createElement("textarea", { rows: 3, placeholder: "Ej. Mi noche de micheladas en El Rey con mis amigos\u2026", value: descripcion, onChange: (e) => setDescripcion(e.target.value) })), /*#__PURE__*/
  React.createElement(Field, { label: "Archivo de video" }, /*#__PURE__*/React.createElement("input", { type: "file", accept: "video/*", onChange: (e) => setArchivo(e.target.files[0] || null) })), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", onClick: subir }, "Subir video")
  ),
  ultimoResultado && /*#__PURE__*/React.createElement("div", { className: 'alert ' + (ultimoResultado.estado === 'rechazado' ? 'danger' : ''), style: { marginTop: 12 } },
  ultimoResultado.estado === 'aprobado' ? '✅ Tu video fue aprobado y ya aparece en la galería pública.' : '❌ Tu video fue dado de baja automáticamente por no promocionar el negocio.'
  ),
  !currentCustomer && /*#__PURE__*/React.createElement("p", { className: "small", style: { marginTop: 8 } }, "Tip: inicia sesi\xF3n para llevar un historial de tus videos subidos.")
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Mis videos subidos"),
  !currentCustomer && /*#__PURE__*/React.createElement("p", { className: "small" }, "Inicia sesi\xF3n para ver tu historial."),
  currentCustomer && misVideos.length === 0 && /*#__PURE__*/React.createElement("p", { className: "small" }, "A\xFAn no has subido videos."),
  currentCustomer && [...misVideos].reverse().map((v) => /*#__PURE__*/React.createElement("div", { key: v.id, className: "flexrow", style: { marginBottom: 8 } }, /*#__PURE__*/
  React.createElement("span", { className: 'tag ' + (v.estado === 'aprobado' ? 'ok' : 'danger') }, v.estado === 'aprobado' ? 'Aprobado' : 'Dado de baja'), /*#__PURE__*/
  React.createElement("span", { className: "small", style: { flex: 1 } }, v.name, " \u2014 ", v.descripcion)
  ))
  )
  ), /*#__PURE__*/
  React.createElement("div", { style: { marginTop: 24 } }, /*#__PURE__*/
  React.createElement("h3", null, "Galer\xEDa de la comunidad"),
  aprobados.length === 0 && /*#__PURE__*/React.createElement("p", { className: "small" }, "A\xFAn no hay videos aprobados. \xA1S\xE9 el primero en promocionar El Rey!"), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-3" },
  [...aprobados].reverse().map((v) => /*#__PURE__*/React.createElement("div", { key: v.id, className: "card" }, /*#__PURE__*/
  React.createElement("video", { src: v.url, controls: true, style: { width: '100%', borderRadius: 8 } }), /*#__PURE__*/
  React.createElement("div", { className: "small", style: { marginTop: 6 } }, /*#__PURE__*/React.createElement("strong", null, v.nombre), " \u2014 ", v.descripcion)
  ))
  )
  )
  );
}

// "Reels" estilo redes sociales: videos aprobados de clientes anteriores, visibles para futuros clientes al final del catálogo.
function ReelsSection({ onSubir }) {
  const { state } = useStore();
  const aprobados = [...state.customerVideos.filter((v) => v.estado === 'aprobado')].reverse();
  return /*#__PURE__*/React.createElement("div", { style: { marginTop: 36 } }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { marginBottom: 12 } }, /*#__PURE__*/
  React.createElement("span", { style: { fontSize: 20 } }, "\uD83C\uDFAC"), /*#__PURE__*/React.createElement("h3", { style: { margin: '0 0 0 8px' } }, "Reels"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: onSubir }, "\uD83D\uDCE4 Sube tu video")
  ),
  aprobados.length === 0 && /*#__PURE__*/React.createElement("p", { className: "small" }, "A\xFAn no hay reels \u2014 s\xE9 el primero en compartir tu experiencia en El Rey."), /*#__PURE__*/
  React.createElement("div", { style: { display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 10 } },
  aprobados.map((v) => /*#__PURE__*/React.createElement("div", { key: v.id, style: { flex: '0 0 210px', borderRadius: 16, overflow: 'hidden', background: 'var(--panel)', border: '1px solid var(--line)' } }, /*#__PURE__*/
  React.createElement("video", { src: v.url, controls: true, muted: true, loop: true, playsInline: true, style: { width: '100%', height: 300, objectFit: 'cover', background: '#000' } }), /*#__PURE__*/
  React.createElement("div", { className: "small", style: { padding: '8px 10px' } }, /*#__PURE__*/React.createElement("strong", null, v.nombre), /*#__PURE__*/React.createElement("br", null), v.descripcion)
  ))
  )
  );
}

function ConocenosCliente() {
  const timeline = [
  { anio: '2019', texto: 'Abrimos las puertas de El Rey con una barra pequeña, unas cuantas mesas y muchas ganas — la primera michelada salió de esta misma receta que seguimos usando hoy.' },
  { anio: '2020', texto: 'Un año difícil para todos los negocios, pero nuestros clientes nos sostuvieron pidiendo para llevar. Aprendimos a reinventarnos sin perder el sabor.' },
  { anio: '2021', texto: 'Reabrimos con más fuerza: ampliamos el corredor exterior y sumamos la línea de bebidas preparadas (mojitos, media de seda, azulito) al menú.' },
  { anio: '2022', texto: 'Empezamos a llevar El Rey fuera de casa: nace el servicio de eventos y micheladas para fiestas particulares.' },
  { anio: '2023', texto: 'Sumamos alitas, botanas y snacks al menú, y el equipo creció — ya no éramos solo dos personas atendiendo la barra.' },
  { anio: '2024', texto: 'Digitalizamos el negocio: tickets electrónicos, control de mesas y turnos para dar un servicio más rápido y ordenado.' },
  { anio: '2025', texto: 'Los eventos se volvieron una parte central del negocio, con paquetes de fichas digitales para que cada fiesta sea más fácil de controlar.' },
  { anio: 'Hoy', texto: 'Seguimos siendo el mismo negocio familiar de siempre — ahora con más mesas, más sabores y la misma pasión por la michelada bien hecha.' }];

  return /*#__PURE__*/React.createElement("div", { className: "section" }, /*#__PURE__*/
  React.createElement("div", { className: "section-head" }, /*#__PURE__*/React.createElement("div", { className: "section-eyebrow" }, "Nuestra historia"), /*#__PURE__*/React.createElement("h2", { className: "section-title" }, "Con\xF3cenos")), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginBottom: 24, background: 'linear-gradient(135deg,var(--bg-soft),var(--panel))' } }, /*#__PURE__*/
  React.createElement("p", { style: { fontSize: 17, lineHeight: 1.6, margin: 0 } }, "\uD83D\uDC51 ", /*#__PURE__*/
  React.createElement("strong", null, "El Rey"), " naci\xF3 como el sue\xF1o de una familia que quer\xEDa servir la michelada perfecta y un lugar donde los amigos se sintieran en casa. Seis a\xF1os despu\xE9s, seguimos siendo el mismo negocio de barrio de siempre: cercano, sabroso y sin pretensiones \u2014 solo buena bebida, buena comida y buena compa\xF1\xEDa. Aqu\xED no eres un cliente m\xE1s, eres parte de la familia de El Rey."


  )
  ), /*#__PURE__*/

  React.createElement("h3", { style: { marginBottom: 14 } }, "C\xF3mo hemos crecido"), /*#__PURE__*/
  React.createElement("div", { style: { position: 'relative', paddingLeft: 24, marginBottom: 28, borderLeft: '2px solid var(--line)' } },
  timeline.map((t, i) => /*#__PURE__*/React.createElement("div", { key: i, style: { position: 'relative', marginBottom: 22 } }, /*#__PURE__*/
  React.createElement("div", { style: { position: 'absolute', left: -31, top: 2, width: 14, height: 14, borderRadius: '50%', background: 'var(--neon)', border: '3px solid var(--bg)' } }), /*#__PURE__*/
  React.createElement("div", { style: { fontWeight: 800, color: 'var(--neon-2)', fontFamily: 'var(--font-display)', fontSize: 18 } }, t.anio), /*#__PURE__*/
  React.createElement("div", { className: "small", style: { marginTop: 2 } }, t.texto)
  ))
  ), /*#__PURE__*/

  React.createElement("div", { className: "grid grid-4", style: { marginBottom: 28 } }, /*#__PURE__*/
  React.createElement("div", { className: "card", style: { textAlign: 'center' } }, /*#__PURE__*/
  React.createElement("div", { style: { fontSize: 28, fontWeight: 800, color: 'var(--neon)' } }, "6 a\xF1os"), /*#__PURE__*/
  React.createElement("div", { className: "small" }, "de historia")
  ), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { textAlign: 'center' } }, /*#__PURE__*/
  React.createElement("div", { style: { fontSize: 28, fontWeight: 800, color: 'var(--neon)' } }, "Miles"), /*#__PURE__*/
  React.createElement("div", { className: "small" }, "de micheladas servidas")
  ), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { textAlign: 'center' } }, /*#__PURE__*/
  React.createElement("div", { style: { fontSize: 28, fontWeight: 800, color: 'var(--neon)' } }, "Cientos"), /*#__PURE__*/
  React.createElement("div", { className: "small" }, "de eventos celebrados")
  ), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { textAlign: 'center' } }, /*#__PURE__*/
  React.createElement("div", { style: { fontSize: 28, fontWeight: 800, color: 'var(--neon)' } }, "Una sola"), /*#__PURE__*/
  React.createElement("div", { className: "small" }, "familia detr\xE1s de todo")
  )
  ), /*#__PURE__*/

  React.createElement("div", { className: "card", style: { background: 'var(--bg-soft)' } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "\uD83D\uDCCD Horarios"), /*#__PURE__*/
  React.createElement("div", { className: "small" }, "Lunes: 1:00 pm \u2013 7:50 pm"), /*#__PURE__*/
  React.createElement("div", { className: "small" }, "Martes a Domingo: 2:00 pm \u2013 10:50 pm")
  ), /*#__PURE__*/

  React.createElement("div", { className: "card", style: { background: 'var(--bg-soft)', marginTop: 16 } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "\uD83D\uDCCD Ubicaci\xF3n"), /*#__PURE__*/
  React.createElement("p", { className: "small", style: { marginTop: 0 } }, "Encu\xE9ntranos aqu\xED \u2014 toca el bot\xF3n para abrir la ruta en Google Maps."), /*#__PURE__*/
  React.createElement("a", { href: "https://maps.app.goo.gl/inwDMyWxLtUzzw2r5", target: "_blank", rel: "noopener noreferrer", className: "btn btn-primary btn-sm" }, "\uD83D\uDCCD C\xF3mo llegar (Google Maps)")
  )
  );
}

/* ============================= ADMIN ============================= */
const ADMIN_SECTIONS = [
{ label: 'Principal', items: [
  { key: 'dashboard', label: 'Menú Principal', icon: '📊' },
  { key: 'pedidos', label: 'Pedidos', icon: '🧾' },
  { key: 'ventas', label: 'Ventas', icon: '💰' },
  { key: 'cancelaciones', label: 'Cancelaciones', icon: '❌' },
  { key: 'proveedores', label: 'Proveedores', icon: '🚚' }]
},
{ label: 'Personal', items: [
  { key: 'usuarios', label: 'Usuarios', icon: '👥' },
  { key: 'personalprueba', label: 'Personal de prueba', icon: '🧪' },
  { key: 'turnos', label: 'Turnos y Zonas', icon: '🗓️' },
  { key: 'evaluaciones', label: 'Evaluaciones de cierre', icon: '⭐' },
  { key: 'sustituciones', label: 'Sustituciones de turno', icon: '🔁' }]
},
{ label: 'Eventos', items: [
  { key: 'solicitudes', label: 'Solicitudes de evento', icon: '🎉' },
  { key: 'bebidaseventos', label: 'Catálogo de bebidas', icon: '🍹' },
  { key: 'ticketsadmin', label: 'Historial de eventos', icon: '🎫' }]
},
{ label: 'Pagos', items: [
  { key: 'transferpend', label: 'Transferencias pendientes', icon: '💳' },
  { key: 'cuentabancaria', label: 'Cuenta bancaria', icon: '🏦' },
  { key: 'cortescaja', label: 'Cortes de caja', icon: '🧮' },
  { key: 'historialpagos', label: 'Historial de pagos', icon: '🧾' },
  { key: 'nomina', label: 'Nómina semanal', icon: '💵' }]
},
{ label: 'Inventario', items: [
  { key: 'reposicion', label: 'Reportes de reposición', icon: '📋' },
  { key: 'menufisico', label: 'Menú físico (imagen)', icon: '📖' }]
},
{ label: 'Horarios', items: [
  { key: 'horarios', label: 'Horarios (cocina y cierre)', icon: '🕛' },
  { key: 'negocio', label: 'Apertura/Cierre del negocio', icon: '🔑' }]
},
{ label: 'Marketing', items: [
  { key: 'temas', label: 'Temas y temporadas', icon: '🎨' },
  { key: 'cumpleanos', label: 'Promoción de cumpleaños', icon: '🎂' },
  { key: 'carrusel', label: 'Carrusel / Campañas', icon: '🖼️' },
  { key: 'cupones', label: 'Cupones', icon: '🏷️' },
  { key: 'historial', label: 'Historial de campañas', icon: '📈' }]
},
{ label: 'Clientes', items: [
  { key: 'clientes', label: 'Cuentas de clientes', icon: '🧑‍🤝‍🧑' },
  { key: 'videosclientes', label: 'Videos de clientes', icon: '🎥' }]
},
{ label: 'Sistema', items: [
  { key: 'conectores', label: 'Conectores', icon: '🔌' }]
},
{ label: 'Finanzas', items: [
  { key: 'gastos', label: 'Gastos', icon: '💸' },
  { key: 'fondocaja', label: 'Fondo de caja (bartender)', icon: '🏦' },
  { key: 'ganancia', label: 'Ganancia neta mensual', icon: '📉' },
  { key: 'pagosprov', label: 'Pagos a proveedores', icon: '🧾' },
  { key: 'cortecaja', label: 'Corte de caja', icon: '🧮' }]
},
{ label: 'Datos y reportes', items: [
  { key: 'reportes', label: 'Reportes', icon: '📤' },
  { key: 'destacados', label: 'Meseros destacados', icon: '🏆' },
  { key: 'bitacora', label: 'Bitácora de auditoría', icon: '📜' }]
},
{ label: 'Cuenta', items: [
  { key: 'cuenta', label: 'Mi cuenta', icon: '⚙️' }]
}];


function AdminView() {
  const { state } = useStore();
  const [section, setSection] = useState('dashboard');
  const stockBajo = state.insumos.filter((i) => i.stock < i.minimo).length;
  const faltantesNoLeidos = state.notifications.filter((n) => !n.leida && n.tipo === 'faltante').length;
  const solicitudesPend = state.eventRequests.filter((r) => r.estado === 'pendiente').length;
  const badges = { pedidos: state.sales.length && 0, solicitudes: solicitudesPend, evaluaciones: state.evaluations.filter((e) => e.stars <= 3 && !e.vistaAdmin).length, transferpend: state.tickets.filter((t) => t.estadoPago === 'Transferencia pendiente de verificar').length, cancelaciones: state.sales.filter((s) => s.estadoPedido === 'Cancelado' && s.fechaCancelacion === todayISO()).length };

  const SECTION_MAP = {
    dashboard: /*#__PURE__*/React.createElement(AdminDashboard, { goto: setSection }),
    pedidos: /*#__PURE__*/React.createElement(AdminPedidos, null),
    ventas: /*#__PURE__*/React.createElement(AdminVentas, null),
    cancelaciones: /*#__PURE__*/React.createElement(AdminCancelaciones, null),
    proveedores: /*#__PURE__*/React.createElement(AdminProveedores, null),
    usuarios: /*#__PURE__*/React.createElement(AdminUsuarios, null),
    personalprueba: /*#__PURE__*/React.createElement(AdminPersonalPrueba, null),
    turnos: /*#__PURE__*/React.createElement(AdminTurnos, null),
    evaluaciones: /*#__PURE__*/React.createElement(AdminEvaluaciones, null),
    sustituciones: /*#__PURE__*/React.createElement(AdminSustituciones, null),
    solicitudes: /*#__PURE__*/React.createElement(AdminEventos, null),
    bebidaseventos: /*#__PURE__*/React.createElement(AdminBebidasEvento, null),
    ticketsadmin: /*#__PURE__*/React.createElement(AdminTickets, null),
    transferpend: /*#__PURE__*/React.createElement(AdminTransferPendientes, null),
    cuentabancaria: /*#__PURE__*/React.createElement(AdminCuentaBancaria, null),
    cortescaja: /*#__PURE__*/React.createElement(AdminCortesCaja, null),
    reposicion: /*#__PURE__*/React.createElement(AdminReposicion, null),
    menufisico: /*#__PURE__*/React.createElement(AdminMenuFisico, null),
    historialpagos: /*#__PURE__*/React.createElement(AdminHistorialPagos, null),
    nomina: /*#__PURE__*/React.createElement(AdminNomina, null),
    horarios: /*#__PURE__*/React.createElement(AdminHorariosCierre, null),
    negocio: /*#__PURE__*/React.createElement(AdminNegocio, null),
    temas: /*#__PURE__*/React.createElement(AdminTemas, null),
    cumpleanos: /*#__PURE__*/React.createElement(AdminCumpleanos, null),
    carrusel: /*#__PURE__*/React.createElement(AdminCarrusel, null),
    cupones: /*#__PURE__*/React.createElement(AdminCupones, null),
    historial: /*#__PURE__*/React.createElement(AdminHistorialCampanas, null),
    clientes: /*#__PURE__*/React.createElement(AdminClientes, null),
    videosclientes: /*#__PURE__*/React.createElement(AdminVideosClientes, null),
    conectores: /*#__PURE__*/React.createElement(AdminConectores, null),
    gastos: /*#__PURE__*/React.createElement(AdminGastos, null),
    fondocaja: /*#__PURE__*/React.createElement(AdminFondoCaja, null),
    ganancia: /*#__PURE__*/React.createElement(AdminGanancia, null),
    pagosprov: /*#__PURE__*/React.createElement(AdminPagosProveedores, null),
    cortecaja: /*#__PURE__*/React.createElement(AdminCorteCaja, null),
    reportes: /*#__PURE__*/React.createElement(AdminReportes, null),
    destacados: /*#__PURE__*/React.createElement(AdminDestacados, null),
    bitacora: /*#__PURE__*/React.createElement(AdminBitacora, null),
    cuenta: /*#__PURE__*/React.createElement(AdminCuenta, null)
  };

  return /*#__PURE__*/React.createElement(PanelLayout, { sections: ADMIN_SECTIONS, section: section, setSection: setSection, badges: { solicitudes: solicitudesPend, transferpend: badges.transferpend, cancelaciones: badges.cancelaciones } },
  SECTION_MAP[section]
  );
}

function AdminDashboard({ goto }) {
  const { state } = useStore();
  const [range, setRange] = useState('hoy');
  const ventasFiltradas = state.sales.filter((s) => inRange(s.fecha, range));
  const totalVentas = ventasFiltradas.reduce((a, s) => a + s.total, 0);
  const pedidosActivos = state.sales.filter((s) => s.fecha === todayISO()).length;
  const stockBajo = state.insumos.filter((i) => i.stock < i.minimo);
  const solicitudesPend = state.eventRequests.filter((r) => r.estado === 'pendiente').length;
  const transferPend = state.tickets.filter((t) => t.estadoPago === 'Transferencia pendiente de verificar').length;
  const proximoEvento = [...state.eventRequests].filter((e) => e.estado === 'aprobada').sort((a, b) => new Date(a.fecha) - new Date(b.fecha))[0];

  const porDia = useMemo(() => {
    const days = [...Array(7)].map((_, i) => {const d = new Date();d.setDate(d.getDate() - (6 - i));return d.toISOString().slice(0, 10);});
    return days.map((d) => ({ label: d.slice(5), value: state.sales.filter((s) => s.fecha === d).reduce((a, s) => a + s.total, 0) }));
  }, [state.sales]);
  const porCategoria = useMemo(() => {
    const map = {};
    state.sales.forEach((s) => {map[s.categoria] = (map[s.categoria] || 0) + s.total;});
    return Object.entries(map).map(([label, value]) => ({ label, value }));
  }, [state.sales]);
  const gastosPorCategoria = useMemo(() => {
    const map = {};
    state.expenses.forEach((g) => {map[g.categoria] = (map[g.categoria] || 0) + Number(g.monto);});
    return EXPENSE_CATEGORIES.map((c) => ({ label: c, value: map[c] || 0 }));
  }, [state.expenses]);

  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", { style: { marginTop: 0 } }, "Panel de Administraci\xF3n"), /*#__PURE__*/
  React.createElement(StockAlertBanner, null), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-4", style: { marginBottom: 16 } }, /*#__PURE__*/
  React.createElement(KpiCard, { label: "Ventas", icon: "\uD83D\uDCB0", value: money(totalVentas), sub: ventasFiltradas.length + ' operaciones', range: range, onRange: setRange }), /*#__PURE__*/
  React.createElement(KpiCard, { label: "Pedidos activos hoy", icon: "\uD83E\uDDFE", value: pedidosActivos }), /*#__PURE__*/
  React.createElement(KpiCard, { label: "Alertas de stock", icon: "\u26A0\uFE0F", value: stockBajo.length, sub: stockBajo.length ? stockBajo.map((s) => s.nombre).join(', ') : 'Todo en orden' }), /*#__PURE__*/
  React.createElement(KpiCard, { label: "Solicitudes de evento", icon: "\uD83C\uDF89", value: solicitudesPend, sub: "pendientes de cotizar" })
  ), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-4", style: { marginBottom: 16 } }, /*#__PURE__*/
  React.createElement(KpiCard, { label: "Clientes registrados", icon: "\uD83E\uDDD1\u200D\uD83E\uDD1D\u200D\uD83E\uDDD1", value: state.customers.length }), /*#__PURE__*/
  React.createElement(KpiCard, { label: "Transferencias por verificar", icon: "\uD83D\uDCB3", value: transferPend })
  ), /*#__PURE__*/
  React.createElement("div", { className: "qa-grid", style: { marginBottom: 18 } }, /*#__PURE__*/
  React.createElement(QuickAction, { icon: "\uD83D\uDE9A", label: "Proveedores", onClick: () => goto('proveedores') }), /*#__PURE__*/
  React.createElement(QuickAction, { icon: "\uD83D\uDCE4", label: "Reportes", onClick: () => goto('reportes') }), /*#__PURE__*/
  React.createElement(QuickAction, { icon: "\uD83E\uDDFE", label: "Ver pedidos", onClick: () => goto('pedidos') }), /*#__PURE__*/
  React.createElement(QuickAction, { icon: "\uD83D\uDDBC\uFE0F", label: "Nueva campa\xF1a", onClick: () => goto('carrusel') })
  ), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-2", style: { marginBottom: 16 } }, /*#__PURE__*/
  React.createElement(ChartCard, { title: "Ventas \xFAltimos 7 d\xEDas" }, /*#__PURE__*/React.createElement(BarChart, { data: porDia })), /*#__PURE__*/
  React.createElement(ChartCard, { title: "Ventas por categor\xEDa" }, /*#__PURE__*/React.createElement(BarChart, { data: porCategoria, color: "var(--neon-2)" }))
  ), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-2", style: { marginBottom: 16 } }, /*#__PURE__*/
  React.createElement(ChartCard, { title: "Gastos por categor\xEDa" }, /*#__PURE__*/React.createElement(BarChart, { data: gastosPorCategoria, color: "var(--danger)" })), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Pr\xF3ximo evento"),
  proximoEvento ? /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("strong", null, proximoEvento.nombre), /*#__PURE__*/
  React.createElement("div", { className: "small" }, fmtDate(proximoEvento.fecha), " \xB7 ", proximoEvento.ubicacion), /*#__PURE__*/
  React.createElement("div", { style: { fontSize: 28, fontWeight: 800, color: 'var(--neon)' } }, diasParaEvento(proximoEvento.fecha), " d\xEDas")
  ) : /*#__PURE__*/React.createElement("p", { className: "small" }, "No hay eventos confirmados.")
  )
  ), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-2" }, /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "\xDAltimos pedidos"), /*#__PURE__*/
  React.createElement(DataTable, { columns: [{ key: 'hora', label: 'Hora' }, { key: 'producto', label: 'Producto' }, { key: 'mesero', label: 'Mesero' }, { key: 'total', label: 'Total', render: (r) => money(r.total) }], rows: [...state.sales].reverse().slice(0, 6) })
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "\uD83E\uDDEE Cortes de caja (notificaciones)"),
  [...state.notifications].filter((n) => n.tipo === 'corte_caja').length === 0 && [...state.notifications].filter((n) => n.tipo === 'corte_caja_bloqueado').length === 0 && /*#__PURE__*/React.createElement("p", { className: "small" }, "Sin cortes registrados todav\xEDa hoy."),
  [...state.notifications].filter((n) => n.tipo === 'corte_caja').slice(-5).reverse().map((n) => /*#__PURE__*/React.createElement("div", { key: n.id, className: 'alert ' + (n.color === 'rojo' ? 'danger' : ''), style: { marginBottom: 8, ...(n.color === 'verde' ? { borderColor: 'var(--ok)' } : n.color === 'amarillo' ? { borderColor: 'var(--warn)' } : {}) } }, /*#__PURE__*/
  React.createElement("div", { style: { fontWeight: 800 } }, n.color === 'verde' ? '✅ Corte cuadrado perfectamente' : n.color === 'amarillo' ? '⚠️ Corte con diferencia menor' : '🚨 Corte con diferencia mayor — revisar'), /*#__PURE__*/
  React.createElement("div", { className: "small" }, "Bartender: ", /*#__PURE__*/React.createElement("strong", null, n.bartender), " \xB7 ", n.hora), /*#__PURE__*/
  React.createElement("div", { className: "small" }, "Ventas del d\xEDa: ", money(n.ventasTotal), " (Efectivo ", money(n.ventasEfectivo), " \xB7 Transferencia ", money(n.ventasTransferencia), ")"), /*#__PURE__*/
  React.createElement("div", { className: "small" }, "Efectivo contado: ", money(n.efectivoContado), " \xB7 Diferencia: ", /*#__PURE__*/React.createElement("strong", null, money(n.diferencia))),
  n.productosAReponer && n.productosAReponer.length > 0 && /*#__PURE__*/React.createElement("div", { className: "small" }, "\uD83D\uDCE6 Reponer: ", n.productosAReponer.join(', '))
  )),
  [...state.notifications].filter((n) => n.tipo === 'corte_caja_bloqueado').slice(-3).reverse().map((n) => /*#__PURE__*/React.createElement("div", { key: n.id, style: { marginTop: 8 } }, /*#__PURE__*/React.createElement(AlertCard, { title: '🚫 Intento de acceso bloqueado al corte', desc: n.intento + ' intentó acceder — el corte de hoy ya lo abrió ' + n.responsable + ' (' + n.hora + ')', tone: "danger" })))
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Alertas y faltantes reportados"),
  stockBajo.map((s) => /*#__PURE__*/React.createElement(AlertCard, { key: s.id, title: 'Stock bajo: ' + s.nombre, desc: 'Quedan ' + s.stock + ' (mínimo ' + s.minimo + ')', tone: "danger" })),
  [...state.notifications].filter((n) => n.tipo === 'pedido_demorado').slice(-4).reverse().map((n) => /*#__PURE__*/React.createElement("div", { key: n.id, style: { marginTop: 8 } }, /*#__PURE__*/React.createElement(AlertCard, { title: '⏰ Pedido tardado: ' + n.producto, desc: 'Mesero: ' + (n.mesero || '—') + ' · lleva ' + n.transcurrido + ' de ' + n.estimado + ' min estimados', tone: "danger" }))),
  [...state.notifications].filter((n) => n.tipo === 'negocio_estado').slice(-4).reverse().map((n) => /*#__PURE__*/React.createElement("div", { key: n.id, style: { marginTop: 8 } }, /*#__PURE__*/React.createElement(AlertCard, { title: (n.estado === 'cerrado' ? '🔒 Negocio cerrado' : '🔓 Negocio abierto') + ' — ' + n.hora, desc: 'Por ' + n.por + '.', tone: n.estado === 'cerrado' ? 'danger' : undefined }))),
  [...state.notifications].filter((n) => n.tipo === 'cocina_estado').slice(-4).reverse().map((n) => /*#__PURE__*/React.createElement("div", { key: n.id, style: { marginTop: 8 } }, /*#__PURE__*/React.createElement(AlertCard, { title: (n.estado === 'cerrada' ? '🍳 Cocina cerrada' : '🍳 Cocina abierta') + ' — ' + n.hora, desc: n.automatico ? 'Automático, según el horario configurado.' : 'Manual, por ' + n.por + '.', tone: n.estado === 'cerrada' ? 'danger' : undefined }))),
  state.notifications.filter((n) => n.tipo === 'sabor_agotado' && !n.atendido).slice(-6).reverse().map((n) => /*#__PURE__*/React.createElement("div", { key: n.id, style: { marginTop: 8 } }, /*#__PURE__*/React.createElement(AlertCard, { title: '🚫 Sabor agotado: ' + n.sabor, desc: n.categoria + ' — reportado por el Cantinero, ' + n.fecha + ' ' + n.hora, tone: "danger" }))),
  state.notifications.filter((n) => n.tipo === 'faltante').slice(-4).reverse().map((n) => /*#__PURE__*/React.createElement("div", { key: n.id, style: { marginTop: 8 } }, /*#__PURE__*/React.createElement(AlertCard, { title: 'Faltante: ' + n.insumo, desc: 'Reportado por ' + n.reportadoPor + ' — ' + n.fecha + ' ' + n.hora }))),
  stockBajo.length === 0 && state.notifications.filter((n) => n.tipo === 'faltante').length === 0 && state.notifications.filter((n) => n.tipo === 'sabor_agotado' && !n.atendido).length === 0 && state.notifications.filter((n) => n.tipo === 'cocina_estado').length === 0 && state.notifications.filter((n) => n.tipo === 'negocio_estado').length === 0 && state.notifications.filter((n) => n.tipo === 'pedido_demorado').length === 0 && /*#__PURE__*/React.createElement("p", { className: "small" }, "Sin alertas activas.")
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "\uD83C\uDF57 Cocina en vivo"),
  comandasEnCola(state).length === 0 && /*#__PURE__*/React.createElement("p", { className: "small" }, "No hay pedidos en cocina ahora mismo."), /*#__PURE__*/
  React.createElement(DataTable, { emptyText: "", columns: [
    { key: 'turno', label: '#', render: (r) => '#' + (comandasEnCola(state).findIndex((c) => c.id === r.id) + 1) },
    { key: 'producto', label: 'Producto' }, { key: 'mesero', label: 'Mesero' },
    { key: 'tiempo', label: 'Tiempo', render: (r) => /*#__PURE__*/React.createElement(BarraProgresoCocina, { venta: r }) },
    { key: 'estadoPedido', label: 'Estado', render: (r) => /*#__PURE__*/React.createElement("span", { className: 'tag ' + (r.estadoPedido === 'En preparación' ? 'warn' : 'info') }, r.estadoPedido || 'Pedido recibido') }],
    rows: comandasEnCola(state) })
  )
  )
  );
}

function AdminPedidos() {
  const { state } = useStore();
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const rows = state.sales.filter((s) => filtroTipo === 'todos' || (filtroTipo === 'establecimiento' ? s.entrega === 'establecimiento' : s.entrega !== 'establecimiento'));
  const editadosHoy = state.sales.filter((s) => (s.edicionesCount || 0) > 0 && (s.historialEdiciones || []).some((h) => h.fecha === todayISO()));
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Pedidos"),
  editadosHoy.length > 0 && /*#__PURE__*/React.createElement("div", { className: "card", style: { marginBottom: 14, borderColor: 'var(--warn)' } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "\u270F\uFE0F Pedidos editados hoy (", editadosHoy.length, ")"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Ediciones hechas por el Mesero o el Cantinero a pedidos ya tomados (m\xE1ximo 2 por pedido)."),
  editadosHoy.map((s) => /*#__PURE__*/React.createElement("div", { key: s.id, style: { marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--line)' } }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow" }, /*#__PURE__*/React.createElement("strong", null, s.producto), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", { className: "tag warn" }, "Editado ", s.edicionesCount, "/", MAX_EDICIONES_PEDIDO)),
  (s.historialEdiciones || []).filter((h) => h.fecha === todayISO()).map((h, i) => /*#__PURE__*/React.createElement("div", { key: i, className: "small", style: { marginTop: 2 } }, "\uD83D\uDD52 ", h.hora, " \xB7 ", /*#__PURE__*/React.createElement("strong", null, h.editadoPor), ": ", h.cambios))
  ))
  ), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { marginBottom: 12 } },
  ['todos', 'establecimiento', 'llevar/domicilio'].map((t) => /*#__PURE__*/React.createElement("button", { key: t, className: 'pill ' + (filtroTipo === (t === 'llevar/domicilio' ? 'llevar' : t) ? 'active' : ''), onClick: () => setFiltroTipo(t === 'llevar/domicilio' ? 'llevar' : t) }, t))
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement(DataTable, { columns: [
    { key: 'fecha', label: 'Fecha' }, { key: 'hora', label: 'Hora' }, { key: 'producto', label: 'Producto', render: (r) => r.producto + ((r.edicionesCount || 0) > 0 ? ' ✏️' : '') }, { key: 'cantidad', label: 'Cant.' },
    { key: 'mesero', label: 'Mesero' }, { key: 'entrega', label: 'Entrega' }, { key: 'pago', label: 'Pago' }, { key: 'total', label: 'Total', render: (r) => money(r.total) }],
    rows: [...rows].reverse() })
  )
  );
}

// Reporte de cancelaciones: permite al admin ver todos los pedidos cancelados del día (y buscar por fecha),
// con motivo, hora y quién canceló, para detectar patrones o problemas recurrentes.
function AdminCancelaciones() {
  const { state } = useStore();
  const [desde, setDesde] = useState(todayISO());
  const [hasta, setHasta] = useState(todayISO());
  const canceladas = state.sales.filter((s) => s.estadoPedido === 'Cancelado' && (!desde || (s.fechaCancelacion || s.fecha) >= desde) && (!hasta || (s.fechaCancelacion || s.fecha) <= hasta));
  const porMotivo = {};
  canceladas.forEach((c) => {porMotivo[c.motivoCancelacion || 'Sin motivo'] = (porMotivo[c.motivoCancelacion || 'Sin motivo'] || 0) + 1;});
  const totalPerdido = canceladas.reduce((a, c) => a + c.total, 0);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "\u274C Cancelaciones"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Pedidos cancelados por el Cantinero o el Mesero, con su motivo \u2014 \xFAtil para detectar patrones o problemas recurrentes."), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginBottom: 14 } }, /*#__PURE__*/
  React.createElement("div", { className: "grid grid-2" }, /*#__PURE__*/
  React.createElement(Field, { label: "Desde" }, /*#__PURE__*/React.createElement("input", { type: "date", value: desde, onChange: (e) => setDesde(e.target.value) })), /*#__PURE__*/
  React.createElement(Field, { label: "Hasta" }, /*#__PURE__*/React.createElement("input", { type: "date", value: hasta, onChange: (e) => setHasta(e.target.value) }))
  )
  ), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-3", style: { marginBottom: 14 } }, /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/React.createElement("div", { className: "small" }, "Pedidos cancelados"), /*#__PURE__*/React.createElement("div", { style: { fontSize: 24, fontWeight: 800 } }, canceladas.length)), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/React.createElement("div", { className: "small" }, "Monto no cobrado"), /*#__PURE__*/React.createElement("div", { style: { fontSize: 24, fontWeight: 800, color: 'var(--danger)' } }, money(totalPerdido))), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/React.createElement("div", { className: "small" }, "Motivo m\xE1s frecuente"), /*#__PURE__*/React.createElement("div", { style: { fontSize: 16, fontWeight: 800 } }, Object.entries(porMotivo).sort((a, b) => b[1] - a[1])[0]?.[0] || '—'))
  ),
  Object.keys(porMotivo).length > 0 && /*#__PURE__*/React.createElement("div", { className: "card", style: { marginBottom: 14 } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Cancelaciones por motivo"),
  Object.entries(porMotivo).sort((a, b) => b[1] - a[1]).map(([m, n]) => /*#__PURE__*/React.createElement("div", { key: m, className: "flexrow small", style: { marginBottom: 4 } }, /*#__PURE__*/React.createElement("span", null, m), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", { style: { fontWeight: 800 } }, n)))
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/React.createElement(DataTable, { emptyText: "Sin cancelaciones en el rango seleccionado.", columns: [
    { key: 'fechaCancelacion', label: 'Fecha', render: (r) => r.fechaCancelacion || r.fecha },
    { key: 'horaCancelacion', label: 'Hora', render: (r) => r.horaCancelacion || r.hora },
    { key: 'producto', label: 'Producto' }, { key: 'total', label: 'Total', render: (r) => money(r.total) },
    { key: 'motivoCancelacion', label: 'Motivo' }, { key: 'canceladoPor', label: 'Cancelado por' }],
    rows: [...canceladas].reverse() }))
  );
}
function AdminVentas() {
  const { state } = useStore();
  const [vendedor, setVendedor] = useState('todos');
  const [tipo, setTipo] = useState('todos');
  const [desde, setDesde] = useState('');const [hasta, setHasta] = useState('');
  const meseros = [...new Set(state.sales.map((s) => s.mesero))];
  const rows = state.sales.filter((s) =>
  (vendedor === 'todos' || s.mesero === vendedor) && (
  tipo === 'todos' || (tipo === 'establecimiento' ? s.entrega === 'establecimiento' : s.entrega !== 'establecimiento')) && (
  !desde || s.fecha >= desde) && (!hasta || s.fecha <= hasta)
  );
  const total = rows.reduce((a, s) => a + s.total, 0);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Ventas"), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginBottom: 14 } }, /*#__PURE__*/
  React.createElement("div", { className: "grid grid-4" }, /*#__PURE__*/
  React.createElement(Field, { label: "Vendedor" }, /*#__PURE__*/React.createElement("select", { value: vendedor, onChange: (e) => setVendedor(e.target.value) }, /*#__PURE__*/React.createElement("option", { value: "todos" }, "Todos"), meseros.map((m) => /*#__PURE__*/React.createElement("option", { key: m }, m)))), /*#__PURE__*/
  React.createElement(Field, { label: "Tipo de entrega" }, /*#__PURE__*/React.createElement("select", { value: tipo, onChange: (e) => setTipo(e.target.value) }, /*#__PURE__*/React.createElement("option", { value: "todos" }, "Todos"), /*#__PURE__*/React.createElement("option", { value: "establecimiento" }, "Establecimiento"), /*#__PURE__*/React.createElement("option", { value: "llevar" }, "Para llevar / domicilio"))), /*#__PURE__*/
  React.createElement(Field, { label: "Desde" }, /*#__PURE__*/React.createElement("input", { type: "date", value: desde, onChange: (e) => setDesde(e.target.value) })), /*#__PURE__*/
  React.createElement(Field, { label: "Hasta" }, /*#__PURE__*/React.createElement("input", { type: "date", value: hasta, onChange: (e) => setHasta(e.target.value) }))
  )
  ), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginBottom: 14 } }, /*#__PURE__*/React.createElement("strong", null, "Total filtrado: ", money(total)), " (", rows.length, " ventas)"), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement(DataTable, { columns: [{ key: 'fecha', label: 'Fecha' }, { key: 'hora', label: 'Hora' }, { key: 'mesero', label: 'Mesero' }, { key: 'producto', label: 'Producto' }, { key: 'variante', label: 'Variante' }, { key: 'sabor', label: 'Sabor' }, { key: 'pago', label: 'Pago' }, { key: 'total', label: 'Total', render: (r) => money(r.total) }], rows: [...rows].reverse() })
  )
  );
}

function BarInventario() {
  const { state, setState, log, toast, notify } = useStore();
  const [nuevoProdCat, setNuevoProdCat] = useState(null); // categoría para la que se está agregando producto
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [variantesNuevo, setVariantesNuevo] = useState([{ nombre: 'Único', precio: '' }]);
  const [confirmarEliminar, setConfirmarEliminar] = useState(null); // {catId,prodId,nombre}

  function updatePrecio(catId, prodId, vIdx, valor) {
    setState((s) => ({ ...s, catalog: s.catalog.map((c) => c.id !== catId ? c : { ...c, productos: c.productos.map((p) => p.id !== prodId ? p : { ...p, variantes: p.variantes.map((v, i) => i !== vIdx ? v : { ...v, precio: Number(valor) }) }) }) }));
  }
  function abrirNuevoProducto(catId) {
    setNuevoProdCat(catId);setNombreNuevo('');setVariantesNuevo([{ nombre: 'Único', precio: '' }]);
  }
  function agregarVarianteFila() {setVariantesNuevo((v) => [...v, { nombre: '', precio: '' }]);}
  function quitarVarianteFila(i) {setVariantesNuevo((v) => v.length > 1 ? v.filter((_, idx) => idx !== i) : v);}
  function actualizarVarianteFila(i, campo, val) {setVariantesNuevo((v) => v.map((row, idx) => idx !== i ? row : { ...row, [campo]: val }));}
  function guardarNuevoProducto() {
    if (!nombreNuevo.trim()) {toast('Escribe el nombre del producto');return;}
    const variantesLimpias = variantesNuevo.filter((v) => v.nombre.trim() !== '').map((v) => ({ nombre: v.nombre.trim(), precio: Number(v.precio) || 0 }));
    if (variantesLimpias.length === 0) {toast('Agrega al menos una variante con nombre');return;}
    const catId = nuevoProdCat;
    setState((s) => ({ ...s, catalog: s.catalog.map((c) => c.id !== catId ? c : { ...c, productos: [...c.productos, { id: uid('p'), nombre: nombreNuevo.trim(), variantes: variantesLimpias }] }) }));
    log('Cantinero', 'Agregó producto ' + nombreNuevo.trim());
    toast('✅ Producto agregado — visible al instante en Administrador, Mesero y Cliente');
    setNuevoProdCat(null);
  }
  function removeProduct(catId, prodId) {
    setState((s) => ({ ...s, catalog: s.catalog.map((c) => c.id !== catId ? c : { ...c, productos: c.productos.filter((p) => p.id !== prodId) }) }));
    toast('🗑️ Producto eliminado');
    setConfirmarEliminar(null);
  }
  function toggleAgotado(catId, prodId, prodNombre, agotadoActual) {
    const nuevoEstado = !agotadoActual;
    setState((s) => ({ ...s, catalog: s.catalog.map((c) => c.id !== catId ? c : { ...c, productos: c.productos.map((p) => p.id !== prodId ? p : { ...p, agotado: nuevoEstado }) }) }));
    log('Cantinero', (nuevoEstado ? 'Marcó agotado: ' : 'Repuso: ') + prodNombre);
    notify({ tipo: nuevoEstado ? 'stock_agotado' : 'stock_repuesto', producto: prodNombre, atendido: false });
    toast(nuevoEstado ? '🔴 ' + prodNombre + ' marcado como agotado — visible al instante en Administrador, Mesero y Cliente' : '🟢 ' + prodNombre + ' repuesto — disponible de nuevo para todos');
  }
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Inventario y cat\xE1logo de productos"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "El Cantinero controla la disponibilidad de productos. Cambios reflejados al instante en Administrador, Mesero y Cliente (mismo estado en memoria)."),
  state.catalog.map((cat) => /*#__PURE__*/React.createElement("div", { className: "card", key: cat.id, style: { marginBottom: 14 } }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow" }, /*#__PURE__*/React.createElement("h3", { style: { margin: 0 } }, EMOJI[cat.id], " ", cat.nombre), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("button", { type: "button", className: "btn btn-secondary btn-sm", onClick: () => abrirNuevoProducto(cat.id) }, "+ Producto")), /*#__PURE__*/
  React.createElement("table", { style: { marginTop: 8 } }, /*#__PURE__*/
  React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Producto"), /*#__PURE__*/React.createElement("th", null, "Variantes / precios"), /*#__PURE__*/React.createElement("th", null, "Disponibilidad"), /*#__PURE__*/React.createElement("th", null))), /*#__PURE__*/
  React.createElement("tbody", null, cat.productos.map((p) => /*#__PURE__*/React.createElement("tr", { key: p.id }, /*#__PURE__*/
  React.createElement("td", null, p.nombre), /*#__PURE__*/
  React.createElement("td", null, p.variantes.map((v, i) => /*#__PURE__*/React.createElement("span", { key: i, className: "chip" }, v.nombre, ": ", /*#__PURE__*/React.createElement("input", { style: { width: 60, display: 'inline-block', padding: '2px 4px', fontSize: 12 }, type: "number", value: v.precio, onChange: (e) => updatePrecio(cat.id, p.id, i, e.target.value) })))), /*#__PURE__*/
  React.createElement("td", null, /*#__PURE__*/
  React.createElement("span", { className: 'tag ' + (p.agotado ? 'danger' : 'ok') }, p.agotado ? '🔴 Agotado' : '🟢 Disponible'), /*#__PURE__*/
  React.createElement("div", { style: { marginTop: 4 } }, /*#__PURE__*/
  React.createElement("button", { type: "button", className: 'btn btn-sm ' + (p.agotado ? 'btn-primary' : 'btn-ghost'), onClick: () => toggleAgotado(cat.id, p.id, p.nombre, p.agotado) }, p.agotado ? 'Reponer producto' : 'Marcar agotado')
  )
  ), /*#__PURE__*/
  React.createElement("td", null,
  confirmarEliminar && confirmarEliminar.prodId === p.id ? /*#__PURE__*/React.createElement("span", { className: "flexrow" }, /*#__PURE__*/
  React.createElement("span", { className: "small" }, "\xBFEliminar?"), /*#__PURE__*/
  React.createElement("button", { type: "button", className: "btn btn-primary btn-sm", onClick: () => removeProduct(cat.id, p.id) }, "S\xED"), /*#__PURE__*/
  React.createElement("button", { type: "button", className: "btn btn-ghost btn-sm", onClick: () => setConfirmarEliminar(null) }, "No")
  ) : /*#__PURE__*/React.createElement("button", { type: "button", className: "btn btn-ghost btn-sm", onClick: () => setConfirmarEliminar({ catId: cat.id, prodId: p.id, nombre: p.nombre }) }, "Eliminar")
  )
  )))
  )
  )), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Combos"), /*#__PURE__*/
  React.createElement(ComboManager, null)
  ), /*#__PURE__*/
  React.createElement("div", { style: { marginTop: 14 } }, /*#__PURE__*/React.createElement(GaleriaImagenesProducto, null)),

  nuevoProdCat && /*#__PURE__*/React.createElement(Modal, { title: 'Nuevo producto en ' + (state.catalog.find((c) => c.id === nuevoProdCat)?.nombre || ''), onClose: () => setNuevoProdCat(null) }, /*#__PURE__*/
  React.createElement("div", { className: "grid", style: { gap: 12 } }, /*#__PURE__*/
  React.createElement(Field, { label: "Nombre del producto" }, /*#__PURE__*/React.createElement("input", { autoFocus: true, value: nombreNuevo, onChange: (e) => setNombreNuevo(e.target.value) })), /*#__PURE__*/
  React.createElement("div", null, /*#__PURE__*/
  React.createElement("div", { className: "small", style: { fontWeight: 700, marginBottom: 6 } }, "Variantes / presentaciones y precio"),
  variantesNuevo.map((v, i) => /*#__PURE__*/React.createElement("div", { key: i, className: "flexrow", style: { marginBottom: 6 } }, /*#__PURE__*/
  React.createElement("input", { placeholder: "Nombre (ej. Completo, Medio, 1L)", value: v.nombre, onChange: (e) => actualizarVarianteFila(i, 'nombre', e.target.value) }), /*#__PURE__*/
  React.createElement("input", { placeholder: "Precio", type: "number", style: { maxWidth: 110 }, value: v.precio, onChange: (e) => actualizarVarianteFila(i, 'precio', e.target.value) }), /*#__PURE__*/
  React.createElement("button", { type: "button", className: "btn btn-ghost btn-sm", onClick: () => quitarVarianteFila(i) }, "\u2715")
  )), /*#__PURE__*/
  React.createElement("button", { type: "button", className: "btn btn-ghost btn-sm", onClick: agregarVarianteFila }, "+ Agregar otra variante")
  ), /*#__PURE__*/
  React.createElement("button", { type: "button", className: "btn btn-primary", onClick: guardarNuevoProducto }, "\u2705 Guardar producto")
  )
  )
  );
}
function ComboManager() {
  const { state, pushTo, removeItem } = useStore();
  const [nombre, setNombre] = useState('');const [precio, setPrecio] = useState('');
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { marginBottom: 10 } }, /*#__PURE__*/
  React.createElement("input", { placeholder: "Nombre del combo (ej. Michelada + Alitas)", value: nombre, onChange: (e) => setNombre(e.target.value) }), /*#__PURE__*/
  React.createElement("input", { placeholder: "Precio", type: "number", style: { maxWidth: 120 }, value: precio, onChange: (e) => setPrecio(e.target.value) }), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", onClick: () => {if (!nombre || !precio) return;pushTo('combos', { id: uid('combo'), nombre, precio: Number(precio) });setNombre('');setPrecio('');} }, "Crear")
  ),
  state.combos.map((c) => /*#__PURE__*/React.createElement("div", { key: c.id, className: "flexrow", style: { marginBottom: 6 } }, /*#__PURE__*/React.createElement("span", null, c.nombre), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("strong", null, money(c.precio)), /*#__PURE__*/React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => removeItem('combos', c.id) }, "Quitar")))
  );
}

function AdminProveedores() {
  const { state, pushTo, removeItem, toast } = useStore();
  const [nombre, setNombre] = useState('');const [tipo, setTipo] = useState('');
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Proveedores"), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginBottom: 14 } }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow" }, /*#__PURE__*/
  React.createElement("input", { placeholder: "Nombre del proveedor", value: nombre, onChange: (e) => setNombre(e.target.value) }), /*#__PURE__*/
  React.createElement("input", { placeholder: "Tipo (cerveza, pollo, papas\u2026)", value: tipo, onChange: (e) => setTipo(e.target.value) }), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", onClick: () => {if (!nombre) return;pushTo('suppliers', { id: uid('sup'), nombre, tipo });setNombre('');setTipo('');toast('Proveedor agregado');} }, "Agregar")
  )
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/React.createElement(DataTable, { columns: [{ key: 'nombre', label: 'Nombre' }, { key: 'tipo', label: 'Tipo' }], rows: state.suppliers, onView: (s) => removeItem('suppliers', s.id) }))
  );
}

function EditarCampoModal({ titulo, valorInicial, onGuardar, onClose, tipo }) {
  const [valor, setValor] = useState(valorInicial);
  return /*#__PURE__*/React.createElement(Modal, { title: titulo, onClose: onClose }, /*#__PURE__*/
  React.createElement("div", { className: "grid", style: { gap: 12 } }, /*#__PURE__*/
  React.createElement("input", { autoFocus: true, type: tipo || 'text', value: valor, onChange: (e) => setValor(e.target.value) }), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", onClick: () => {onGuardar(valor);onClose();} }, "Guardar")
  )
  );
}
function AdminUsuarios() {
  const { state, pushTo, updateItem, toast } = useStore();
  const [nombre, setNombre] = useState('');const [rol, setRol] = useState('mesero');const [tel, setTel] = useState('');
  const [usuario, setUsuario] = useState('');const [password, setPassword] = useState('');
  const [editandoHorario, setEditandoHorario] = useState(null); // staff seleccionado
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Usuarios / Personal"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "El personal ya no se auto-registra desde el login p\xFAblico \u2014 el administrador es quien da de alta cada cuenta de personal (usuario y contrase\xF1a) desde este formulario."), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginBottom: 14 } }, /*#__PURE__*/
  React.createElement("div", { className: "grid grid-4" }, /*#__PURE__*/
  React.createElement("input", { placeholder: "Nombre", value: nombre, onChange: (e) => setNombre(e.target.value) }), /*#__PURE__*/
  React.createElement("select", { value: rol, onChange: (e) => setRol(e.target.value) }, /*#__PURE__*/React.createElement("option", { value: "mesero" }, "Mesero"), /*#__PURE__*/React.createElement("option", { value: "bartender" }, "Bartender"), /*#__PURE__*/React.createElement("option", { value: "cocinera" }, "Cocinera"), /*#__PURE__*/React.createElement("option", { value: "admin" }, "Administrador")), /*#__PURE__*/
  React.createElement("input", { placeholder: "Tel\xE9fono", value: tel, onChange: (e) => setTel(e.target.value) }), /*#__PURE__*/
  React.createElement("input", { placeholder: "Usuario (login)", value: usuario, onChange: (e) => setUsuario(e.target.value) }), /*#__PURE__*/
  React.createElement("input", { placeholder: "Contrase\xF1a (login)", value: password, onChange: (e) => setPassword(e.target.value) }), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", onClick: () => {if (!nombre || !usuario || !password) {toast('Completa nombre, usuario y contraseña');return;}pushTo('staff', { id: uid('st'), nombre, rol, telefono: tel, usuario, password, entrada: rol === 'bartender' ? '12:00' : rol === 'cocinera' ? '14:30' : rol === 'admin' ? '—' : '14:00', salida: rol === 'cocinera' ? '22:30' : rol === 'admin' ? '—' : '23:00' });setNombre('');setTel('');setUsuario('');setPassword('');toast('Empleado agregado con acceso de personal');} }, "Agregar")
  )
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement(DataTable, { columns: [
    { key: 'nombre', label: 'Nombre' }, { key: 'rol', label: 'Rol' }, { key: 'telefono', label: 'Teléfono' }, { key: 'usuario', label: 'Usuario', render: (r) => r.usuario || '—' },
    { key: 'entrada', label: 'Entrada' }, { key: 'salida', label: 'Salida' },
    { key: 'cuentaBanco', label: 'Cuenta bancaria', render: (r) => r.cuentaBanco || '—' }],
    rows: state.staff.filter((s) => !(s.esPrueba && s.estadoPrueba === 'activo')), onView: (s) => setEditandoHorario(s) })
  ), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Contacto telef\xF3nico directo disponible desde esta tabla (dato informativo, sin integraci\xF3n real). Haz clic en \"Ver\" para cambiar la hora de entrada."),
  editandoHorario && /*#__PURE__*/React.createElement(EditarCampoModal, { titulo: 'Nueva hora de entrada para ' + editandoHorario.nombre, valorInicial: editandoHorario.entrada,
    onClose: () => setEditandoHorario(null),
    onGuardar: (val) => {updateItem('staff', editandoHorario.id, { entrada: val });toast('Horario actualizado');} })
  );
}

// Personal de prueba: el administrador crea accesos temporales de 7 días. Al vencer, el acceso se bloquea
// automáticamente (ver iniciarSesionUnico). El admin puede aprobar (se vuelve personal permanente) o rechazar.
function AdminPersonalPrueba() {
  const { state, pushTo, updateItem, removeItem, toast, log } = useStore();
  const [nombre, setNombre] = useState('');const [rol, setRol] = useState('mesero');const [tel, setTel] = useState('');
  const [usuario, setUsuario] = useState('');const [password, setPassword] = useState('');

  const enPrueba = state.staff.filter((s) => s.esPrueba && s.estadoPrueba === 'activo');
  const historial = state.staff.filter((s) => s.esPrueba && s.estadoPrueba !== 'activo');

  function crearAcceso() {
    if (!nombre || !usuario || !password) {toast('Completa nombre, usuario y contraseña');return;}
    if (state.staff.some((st) => (st.usuario || '').toLowerCase() === usuario.toLowerCase())) {toast('Ese usuario ya existe');return;}
    const hoy = todayISO();
    pushTo('staff', {
      id: uid('st'), nombre, rol, telefono: tel, usuario, password,
      entrada: rol === 'bartender' ? '12:00' : rol === 'cocinera' ? '14:30' : '14:00',
      salida: rol === 'cocinera' ? '22:30' : '23:00',
      esPrueba: true, estadoPrueba: 'activo', fechaAlta: hoy, fechaVencimiento: sumarDiasISO(hoy, 7)
    });
    log('Administrador', 'Creó acceso de personal de prueba para ' + nombre + ' (' + rol + '), vence el ' + sumarDiasISO(hoy, 7));
    toast('🧪 Acceso de prueba creado — vence el ' + fmtDate(sumarDiasISO(hoy, 7)));
    setNombre('');setTel('');setUsuario('');setPassword('');
  }

  function aprobar(s) {
    updateItem('staff', s.id, { esPrueba: false, estadoPrueba: 'aprobado' });
    log('Administrador', 'Aprobó a ' + s.nombre + ' — ahora es personal permanente');
    toast('✅ ' + s.nombre + ' ahora es personal permanente');
  }
  function rechazar(s) {
    updateItem('staff', s.id, { estadoPrueba: 'rechazado' });
    log('Administrador', 'Rechazó el acceso de prueba de ' + s.nombre);
    toast('⛔ Acceso de ' + s.nombre + ' rechazado y bloqueado');
  }
  function eliminarDelHistorial(s) {removeItem('staff', s.id);toast('Registro eliminado');}

  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Personal de prueba"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Crea accesos temporales de ", /*#__PURE__*/React.createElement("strong", null, "7 d\xEDas"), " para personal nuevo en capacitaci\xF3n. Al vencer el plazo, el acceso se bloquea autom\xE1ticamente. Antes de que venza (o despu\xE9s), puedes aprobarlo para convertirlo en personal permanente, o rechazarlo para bloquearlo de inmediato."), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginBottom: 14 } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Crear acceso temporal"), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-4" }, /*#__PURE__*/
  React.createElement("input", { placeholder: "Nombre", value: nombre, onChange: (e) => setNombre(e.target.value) }), /*#__PURE__*/
  React.createElement("select", { value: rol, onChange: (e) => setRol(e.target.value) }, /*#__PURE__*/React.createElement("option", { value: "mesero" }, "Mesero"), /*#__PURE__*/React.createElement("option", { value: "bartender" }, "Bartender"), /*#__PURE__*/React.createElement("option", { value: "cocinera" }, "Cocinera")), /*#__PURE__*/
  React.createElement("input", { placeholder: "Tel\xE9fono", value: tel, onChange: (e) => setTel(e.target.value) }), /*#__PURE__*/
  React.createElement("input", { placeholder: "Usuario (login)", value: usuario, onChange: (e) => setUsuario(e.target.value) }), /*#__PURE__*/
  React.createElement("input", { placeholder: "Contrase\xF1a (login)", value: password, onChange: (e) => setPassword(e.target.value) }), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", onClick: crearAcceso }, "\uD83E\uDDEA Crear acceso de 7 d\xEDas")
  )
  ), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginBottom: 14 } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Accesos activos (", enPrueba.length, ")"),
  enPrueba.length === 0 && /*#__PURE__*/React.createElement("p", { className: "small" }, "No hay personal de prueba activo."),
  enPrueba.map((s) => {
    const dias = diasRestantesPrueba(s);
    const vencido = pruebaVencida(s);
    return /*#__PURE__*/React.createElement("div", { key: s.id, className: "card", style: { marginBottom: 10, background: 'var(--bg-soft)' } }, /*#__PURE__*/
    React.createElement("div", { className: "flexrow" }, /*#__PURE__*/
    React.createElement("div", null, /*#__PURE__*/React.createElement("strong", null, s.nombre), " \u2014 ", s.rol, /*#__PURE__*/React.createElement("div", { className: "small" }, "Usuario: ", s.usuario, " \xB7 Alta: ", fmtDate(s.fechaAlta), " \xB7 Vence: ", fmtDate(s.fechaVencimiento))), /*#__PURE__*/
    React.createElement("span", { className: "spacer" }), /*#__PURE__*/
    React.createElement("span", { className: 'tag ' + (vencido ? 'danger' : dias <= 2 ? 'warn' : 'ok') }, vencido ? '🔴 Vencido' : '🟢 ' + dias + ' día(s) restantes')
    ), /*#__PURE__*/
    React.createElement("div", { className: "flexrow", style: { marginTop: 8 } }, /*#__PURE__*/
    React.createElement("button", { className: "btn btn-primary btn-sm", onClick: () => aprobar(s) }, "\u2705 Aprobar (permanente)"), /*#__PURE__*/
    React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => rechazar(s) }, "\u26D4 Rechazar")
    )
    );
  })
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Historial de personal de prueba"), /*#__PURE__*/
  React.createElement(DataTable, { emptyText: "Sin historial a\xFAn.", columns: [
    { key: 'nombre', label: 'Nombre' }, { key: 'rol', label: 'Rol' },
    { key: 'fechaAlta', label: 'Alta', render: (r) => fmtDate(r.fechaAlta) },
    { key: 'fechaVencimiento', label: 'Vencimiento', render: (r) => fmtDate(r.fechaVencimiento) },
    { key: 'estadoPrueba', label: 'Estado', render: (r) => /*#__PURE__*/React.createElement("span", { className: 'tag ' + (r.estadoPrueba === 'aprobado' ? 'ok' : 'danger') }, r.estadoPrueba === 'aprobado' ? '✅ Aprobado' : r.estadoPrueba === 'rechazado' ? '⛔ Rechazado' : '🔴 Vencido') },
    { key: 'acciones', label: '', render: (r) => /*#__PURE__*/React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => eliminarDelHistorial(r) }, "Eliminar") }],
    rows: [...historial].reverse() })
  )
  );
}

function AdminTurnos() {
  const { state, pushTo, removeItem, toast, log } = useStore();
  const meseros = state.staff.filter((s) => s.rol === 'mesero');
  const week = getISOWeek(new Date());
  const dias = [...Array(7)].map((_, i) => {const d = new Date();d.setDate(d.getDate() - d.getDay() + i);return d;});
  const conteos = {};
  state.sales.forEach((s) => {conteos[s.mesero] = (conteos[s.mesero] || 0) + 1;});

  const [fecha, setFecha] = useState(todayISO());
  const [zona, setZona] = useState('Interior');
  const [meseroId, setMeseroId] = useState('');
  const [motivo, setMotivo] = useState('');
  const zonasParaFecha = zonasEfectivasDelDia(state, new Date(fecha + 'T00:00:00'));

  function registrarAsignacion() {
    const m = state.staff.find((s) => s.id === meseroId);
    if (!m) {toast('Selecciona qué mesero va a atender esa zona');return;}
    // Reemplaza cualquier asignación previa para esa fecha+zona
    const existente = state.shiftOverrides.find((o) => o.fecha === fecha && o.zona === zona);
    if (existente) removeItem('shiftOverrides', existente.id);
    pushTo('shiftOverrides', { id: uid('ov'), fecha, zona, meseroId: m.id, meseroNombre: m.nombre, motivo: motivo || 'Asignado por el administrador' });
    log('Administrador', 'Asignó a ' + m.nombre + ' a la zona ' + zona + ' el ' + fecha + (motivo ? ' (' + motivo + ')' : ''));
    toast('✅ ' + m.nombre + ' atenderá ' + zona + ' el ' + fmtDate(fecha));
    setMeseroId('');setMotivo('');
  }
  function quitarAsignacion(o) {removeItem('shiftOverrides', o.id);toast('Asignación eliminada — vuelve a la rotación base');}

  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Turnos y Zonas"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Cada d\xEDa trabajan ", /*#__PURE__*/React.createElement("strong", null, "los dos meseros"), " al mismo tiempo, uno en Interior y otro en Corredor \u2014 no se sustituyen entre s\xED, se les asigna una zona distinta. El administrador puede editar esta asignaci\xF3n para cualquier d\xEDa (por ejemplo, decirle a Sergio que le toca afuera y a Karla que le toca adentro, o cubrir a alguien que avis\xF3 que faltar\xE1)."), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginBottom: 14 } }, /*#__PURE__*/
  React.createElement("div", { className: "small" }, "Semana ISO actual: ", /*#__PURE__*/React.createElement("strong", null, week), " (", week % 2 === 1 ? 'Semana A' : 'Semana B', ")"), /*#__PURE__*/
  React.createElement("table", { style: { marginTop: 10 } }, /*#__PURE__*/
  React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "D\xEDa"), /*#__PURE__*/React.createElement("th", null, "Interior"), /*#__PURE__*/React.createElement("th", null, "Corredor"))), /*#__PURE__*/
  React.createElement("tbody", null, dias.map((d) => {
    const z = zonasEfectivasDelDia(state, d);
    return /*#__PURE__*/React.createElement("tr", { key: d.toISOString() }, /*#__PURE__*/
    React.createElement("td", null, DIAS[d.getDay()], " ", d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' })), /*#__PURE__*/
    React.createElement("td", null, /*#__PURE__*/React.createElement("span", { className: 'tag ' + (z.Interior.asignadoPorAdmin ? 'warn' : 'ok') }, z.Interior.mesero || '—', z.Interior.asignadoPorAdmin ? ' ✏️' : '')), /*#__PURE__*/
    React.createElement("td", null, /*#__PURE__*/React.createElement("span", { className: 'tag ' + (z.Corredor.asignadoPorAdmin ? 'warn' : 'ok') }, z.Corredor.mesero || '—', z.Corredor.asignadoPorAdmin ? ' ✏️' : ''))
    );
  }))
  )
  ), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginBottom: 14, maxWidth: 560 } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Asignar mesero a una zona"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Elige la fecha, la zona (Interior o Corredor) y qui\xE9n la va a atender ese d\xEDa \u2014 ya sea para armar el turno normal o para cubrir a alguien que avis\xF3 que faltar\xE1."), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-2" }, /*#__PURE__*/
  React.createElement(Field, { label: "Fecha" }, /*#__PURE__*/React.createElement("input", { type: "date", value: fecha, onChange: (e) => setFecha(e.target.value) })), /*#__PURE__*/
  React.createElement(Field, { label: "Zona" }, /*#__PURE__*/React.createElement("select", { value: zona, onChange: (e) => setZona(e.target.value) }, /*#__PURE__*/
  React.createElement("option", { value: "Interior" }, "Interior"), /*#__PURE__*/React.createElement("option", { value: "Corredor" }, "Corredor")
  ))
  ), /*#__PURE__*/
  React.createElement("div", { className: "small", style: { marginBottom: 8 } }, "Actualmente esa zona ese d\xEDa la atiende: ", /*#__PURE__*/React.createElement("strong", null, zonasParaFecha[zona].mesero || '—'), zonasParaFecha[zona].asignadoPorAdmin ? ' (ya asignado manualmente)' : ' (rotación automática)'), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-2" }, /*#__PURE__*/
  React.createElement(Field, { label: "\xBFQui\xE9n va a atender esta zona?" }, /*#__PURE__*/React.createElement("select", { value: meseroId, onChange: (e) => setMeseroId(e.target.value) }, /*#__PURE__*/
  React.createElement("option", { value: "" }, "Selecciona\u2026"),
  meseros.map((m) => /*#__PURE__*/React.createElement("option", { key: m.id, value: m.id }, m.nombre))
  )), /*#__PURE__*/
  React.createElement(Field, { label: "Motivo (opcional)" }, /*#__PURE__*/React.createElement("input", { placeholder: "Ej. Luis report\xF3 falta", value: motivo, onChange: (e) => setMotivo(e.target.value) }))
  ), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary btn-sm", style: { marginTop: 8 }, onClick: registrarAsignacion }, "Asignar")
  ), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginBottom: 14 } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Asignaciones manuales activas"), /*#__PURE__*/
  React.createElement(DataTable, { emptyText: "Sin asignaciones manuales registradas.", columns: [
    { key: 'fecha', label: 'Fecha', render: (r) => fmtDate(r.fecha) }, { key: 'zona', label: 'Zona' }, { key: 'meseroNombre', label: 'Atiende' }, { key: 'motivo', label: 'Motivo' }],
    rows: [...state.shiftOverrides].reverse(), onView: quitarAsignacion }), /*#__PURE__*/
  React.createElement("p", { className: "small", style: { marginTop: 6 } }, "Clic en \"Ver\" para quitar una asignaci\xF3n manual (regresa a la rotaci\xF3n autom\xE1tica).")
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Mesas atendidas (seg\xFAn ventas registradas)"), /*#__PURE__*/
  React.createElement(DataTable, { columns: [{ key: 'mesero', label: 'Mesero' }, { key: 'total', label: 'Pedidos registrados' }], rows: Object.entries(conteos).map(([mesero, total]) => ({ id: mesero, mesero, total })) })
  )
  );
}

function AdminEvaluaciones() {
  const { state, pushTo, updateItem, toast } = useStore();
  const [meseroId, setMeseroId] = useState('');const [stars, setStars] = useState(5);const [comentario, setComentario] = useState('');
  const criterios = ['Lavado de baños', 'Acomodo de sillas y mesas', 'Barrido', 'Trapeado'];
  const [crit, setCrit] = useState({});
  const meseros = state.staff.filter((s) => s.rol === 'mesero');
  const bartender = state.staff.find((s) => s.rol === 'bartender');

  function guardar() {
    if (!meseroId) {toast('Selecciona un mesero');return;}
    if (stars <= 3 && !comentario.trim()) {toast('Con 3 estrellas o menos el comentario es obligatorio.');return;}
    const mesero = meseros.find((m) => m.id === meseroId);
    pushTo('evaluations', { id: uid('ev'), meseroId, meseroNombre: mesero.nombre, bartenderNombre: bartender ? bartender.nombre : 'Bartender', fecha: todayISO(), stars, criterios: crit, comentario, vistaAdmin: false });
    setMeseroId('');setStars(5);setComentario('');setCrit({});
  }
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Evaluaciones de cierre"), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-2" }, /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Nueva evaluaci\xF3n (simulando vista del bartender)"), /*#__PURE__*/
  React.createElement(Field, { label: "Mesero" }, /*#__PURE__*/React.createElement("select", { value: meseroId, onChange: (e) => setMeseroId(e.target.value) }, /*#__PURE__*/React.createElement("option", { value: "" }, "Selecciona\u2026"), meseros.map((m) => /*#__PURE__*/React.createElement("option", { key: m.id, value: m.id }, m.nombre)))),
  criterios.map((c) => /*#__PURE__*/React.createElement("div", { key: c, className: "flexrow", style: { margin: '6px 0' } }, /*#__PURE__*/React.createElement("span", { style: { flex: 1 } }, c), /*#__PURE__*/React.createElement("input", { type: "checkbox", style: { width: 'auto' }, checked: !!crit[c], onChange: (e) => setCrit({ ...crit, [c]: e.target.checked }) }))), /*#__PURE__*/
  React.createElement(Field, { label: "Calificaci\xF3n general" }, /*#__PURE__*/React.createElement(StarRating, { value: stars, onChange: setStars })), /*#__PURE__*/
  React.createElement(Field, { label: 'Comentario' + (stars <= 3 ? ' (obligatorio)' : ' (opcional)') }, /*#__PURE__*/React.createElement("textarea", { rows: 3, value: comentario, onChange: (e) => setComentario(e.target.value) })), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", style: { marginTop: 10 }, onClick: guardar }, "Guardar evaluaci\xF3n")
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Historial (visible tambi\xE9n para el mesero evaluado)"),
  [...state.evaluations].reverse().map((ev) => /*#__PURE__*/React.createElement("div", { key: ev.id, className: "card", style: { background: 'var(--bg-soft)', marginBottom: 8 } }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow" }, /*#__PURE__*/React.createElement("strong", null, ev.meseroNombre), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement(StarRating, { value: ev.stars, onChange: () => {} })), /*#__PURE__*/
  React.createElement("div", { className: "small" }, ev.fecha, " \xB7 evaluado por ", ev.bartenderNombre),
  ev.comentario && /*#__PURE__*/React.createElement("div", { className: "small", style: { marginTop: 4 } }, "\"", ev.comentario, "\"")
  )),
  state.evaluations.length === 0 && /*#__PURE__*/React.createElement("p", { className: "small" }, "Sin evaluaciones a\xFAn.")
  )
  ), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginTop: 16 } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "\u26A0\uFE0F Sanciones por bloqueo indebido de mesas"), /*#__PURE__*/
  React.createElement(DataTable, { emptyText: "Sin sanciones registradas.", columns: [
    { key: 'fecha', label: 'Fecha' }, { key: 'meseroNombre', label: 'Mesero' }, { key: 'mesaNumero', label: 'Mesa' }, { key: 'zona', label: 'Zona' }, { key: 'motivo', label: 'Motivo' }],
    rows: [...state.tableSanciones].reverse() })
  )
  );
}

function AdminSustituciones() {
  const { state, pushTo, toast } = useStore();
  const [original, setOriginal] = useState('');const [sustituto, setSustituto] = useState('');const [motivo, setMotivo] = useState('');
  const empleados = state.staff.filter((s) => s.rol === 'mesero' || s.rol === 'cocinera');
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Sustituciones de turno"), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginBottom: 14 } }, /*#__PURE__*/
  React.createElement("div", { className: "grid grid-3" }, /*#__PURE__*/
  React.createElement(Field, { label: "Empleado que falta" }, /*#__PURE__*/React.createElement("select", { value: original, onChange: (e) => setOriginal(e.target.value) }, /*#__PURE__*/React.createElement("option", { value: "" }, "Selecciona\u2026"), empleados.map((e) => /*#__PURE__*/React.createElement("option", { key: e.id }, e.nombre)))), /*#__PURE__*/
  React.createElement(Field, { label: "Cubre" }, /*#__PURE__*/React.createElement("select", { value: sustituto, onChange: (e) => setSustituto(e.target.value) }, /*#__PURE__*/React.createElement("option", { value: "" }, "Selecciona\u2026"), empleados.map((e) => /*#__PURE__*/React.createElement("option", { key: e.id }, e.nombre)))), /*#__PURE__*/
  React.createElement(Field, { label: "Motivo" }, /*#__PURE__*/React.createElement("input", { value: motivo, onChange: (e) => setMotivo(e.target.value) }))
  ), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", style: { marginTop: 10 }, onClick: () => {if (!original || !sustituto) return;pushTo('substitutions', { id: uid('sub'), original, sustituto, motivo, fecha: todayISO() });toast('Sustitución registrada');setOriginal('');setSustituto('');setMotivo('');} }, "Registrar sustituci\xF3n")
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/React.createElement(DataTable, { columns: [{ key: 'fecha', label: 'Fecha' }, { key: 'original', label: 'Faltó' }, { key: 'sustituto', label: 'Cubrió' }, { key: 'motivo', label: 'Motivo' }], rows: [...state.substitutions].reverse() }))
  );
}

function AdminEventos() {
  const { state, pushTo, updateItem, toast, notify, crearFolioYTicket } = useStore();
  const [cotizando, setCotizando] = useState(null);
  const [itemsEdit, setItemsEdit] = useState([]);
  const [modoAnticipo, setModoAnticipo] = useState('pct');
  const [anticipoPct, setAnticipoPct] = useState(50);
  const [anticipoMonto, setAnticipoMonto] = useState(0);
  const [filtro, setFiltro] = useState('todos');

  function abrirCotizacion(req) {
    setCotizando(req);
    setItemsEdit((req.items || []).map((i) => ({ ...i, precioUnitarioFinal: i.precioUnitarioFinal != null ? i.precioUnitarioFinal : i.precioUnitarioRef })));
    setAnticipoPct(req.anticipoPct || 50);
    setModoAnticipo('pct');
    const totalPrevio = req.totalCotizado || req.totalEstimado || 0;
    setAnticipoMonto(req.anticipoMonto || Math.round(totalPrevio * 0.5));
  }
  const totalCotizadoLive = itemsEdit.reduce((a, i) => a + (Number(i.precioUnitarioFinal) || 0) * i.cantidad, 0);
  const anticipoFinal = modoAnticipo === 'pct' ? Math.round(totalCotizadoLive * anticipoPct / 100) : Number(anticipoMonto) || 0;
  const anticipoPctEquivalente = totalCotizadoLive > 0 ? Math.round(anticipoFinal / totalCotizadoLive * 100) : 0;

  function actualizarPrecioItem(itemId, valor) {
    setItemsEdit((prev) => prev.map((i) => i.id === itemId ? { ...i, precioUnitarioFinal: valor } : i));
  }
  function guardarCotizacion() {
    updateItem('eventRequests', cotizando.id, { items: itemsEdit, totalCotizado: totalCotizadoLive, estado: 'cotizada' });
    toast('💾 Cotización guardada — el cliente aún no la ve como final hasta que la apruebes');
    setCotizando(null);
  }
  function aprobar() {
    const folio = crearFolioYTicket('EVT', {
      clienteNombre: cotizando.nombre, clienteEmail: cotizando.clienteEmail || '',
      tipoPedido: 'Evento', items: itemsEdit.map((i) => ({ nombre: i.nombreLibre || state.bebidasEvento.find((b) => b.id === i.bebidaId)?.nombre || 'Bebida', cantidad: i.cantidad, total: (Number(i.precioUnitarioFinal) || 0) * i.cantidad })),
      subtotal: totalCotizadoLive, descuento: 0, total: totalCotizadoLive,
      metodoPago: '—', estadoPago: 'Anticipo pendiente', empleado: ''
    });
    updateItem('eventRequests', cotizando.id, {
      items: itemsEdit, totalCotizado: totalCotizadoLive, estado: 'aprobada', folio,
      anticipoPct: modoAnticipo === 'pct' ? anticipoPct : anticipoPctEquivalente,
      anticipoMonto: anticipoFinal, anticipoPagado: false, liquidado: false
    });
    notify({ tipo: 'evento_aprobado', destino: 'cliente', clienteEmail: cotizando.clienteEmail || '', folio, nombreEvento: cotizando.nombre, atendido: false });
    toast('✅ Solicitud aprobada — folio ' + folio + ' generado. Notificación enviada al cliente (simulado: WhatsApp/correo).');
    setCotizando(null);
  }
  function rechazar() {
    updateItem('eventRequests', cotizando.id, { estado: 'rechazada' });
    toast('Solicitud rechazada');
    setCotizando(null);
  }

  const solicitudesFiltradas = filtro === 'todos' ? state.eventRequests : state.eventRequests.filter((r) => r.estado === filtro);
  const conteos = {
    todos: state.eventRequests.length,
    pendiente: state.eventRequests.filter((r) => r.estado === 'pendiente').length,
    cotizada: state.eventRequests.filter((r) => r.estado === 'cotizada').length,
    aprobada: state.eventRequests.filter((r) => r.estado === 'aprobada').length,
    rechazada: state.eventRequests.filter((r) => r.estado === 'rechazada').length
  };

  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Solicitudes de evento"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Revisa cada solicitud, ajusta el precio de cada bebida a tu gusto, define el anticipo y aprueba para generar el folio \u2014 todo se recalcula en vivo."), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { marginBottom: 14, flexWrap: 'wrap' } },
  [['todos', 'Todos'], ['pendiente', '🟡 Pendientes'], ['cotizada', '💬 Cotizadas'], ['aprobada', '🟢 Aprobadas'], ['rechazada', '🔴 Rechazadas']].map(([k, l]) => /*#__PURE__*/
  React.createElement("button", { key: k, className: 'pill ' + (filtro === k ? 'active' : ''), onClick: () => setFiltro(k) }, l, " (", conteos[k], ")"))
  ), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-2" },
  solicitudesFiltradas.map((ev) => {
    const totalMostrar = ev.totalCotizado != null ? ev.totalCotizado : ev.totalEstimado;
    return /*#__PURE__*/React.createElement("div", { key: ev.id, className: "card" }, /*#__PURE__*/
    React.createElement("div", { className: "flexrow" }, /*#__PURE__*/React.createElement("strong", null, ev.nombre), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/
    React.createElement("span", { className: 'tag ' + (ev.estado === 'aprobada' ? 'ok' : ev.estado === 'rechazada' ? 'danger' : ev.estado === 'cotizada' ? 'info' : 'warn') },
    ev.estado === 'aprobada' ? '🟢 Aprobada' : ev.estado === 'rechazada' ? '🔴 Rechazada' : ev.estado === 'cotizada' ? '💬 Cotizada' : '🟡 Pendiente'
    )
    ), /*#__PURE__*/
    React.createElement("div", { className: "small" }, fmtDate(ev.fecha), " \xB7 ", ev.ubicacion, " \xB7 ", ev.personas, " personas", ev.telefono ? ' · 📞 ' + ev.telefono : ''), /*#__PURE__*/
    React.createElement("div", { className: "small", style: { margin: '6px 0' } },
    (ev.items || []).map((i) => /*#__PURE__*/React.createElement("div", { key: i.id }, i.nombreLibre || state.bebidasEvento.find((b) => b.id === i.bebidaId)?.nombre || 'Bebida', i.sabor ? ' (' + i.sabor + ')' : '', " \xD7 ", i.cantidad))
    ), /*#__PURE__*/
    React.createElement("div", { style: { fontWeight: 800 } }, money(totalMostrar), " ", ev.totalCotizado == null && /*#__PURE__*/React.createElement("span", { className: "tag warn", style: { marginLeft: 6 } }, "estimado")),
    ev.folio && /*#__PURE__*/React.createElement("div", { className: "small", style: { marginTop: 2 } }, "\uD83C\uDFAB Folio: ", /*#__PURE__*/React.createElement("strong", null, ev.folio), " \xB7 Anticipo: ", money(ev.anticipoMonto || 0)),
    ev.estado === 'aprobada' && /*#__PURE__*/React.createElement("div", { className: "small" }, "\uD83D\uDCC5 Faltan ", diasParaEvento(ev.fecha), " d\xEDas ", diasParaEvento(ev.fecha) <= 5 && '🔴'),
    ev.estado === 'aprobada' && /*#__PURE__*/React.createElement("div", { className: "flexrow", style: { marginTop: 8 } }, /*#__PURE__*/
    React.createElement("button", { className: "btn btn-secondary btn-sm", disabled: ev.anticipoPagado, onClick: () => {
        updateItem('eventRequests', ev.id, { anticipoPagado: true });
        if (ev.folio) {const tk = state.tickets.find((t) => t.folio === ev.folio);if (tk) updateItem('tickets', tk.id, { estadoPago: 'Pago confirmado' });}
      } }, ev.anticipoPagado ? '✅ Anticipo confirmado' : 'Confirmar anticipo manualmente'), /*#__PURE__*/
    React.createElement("button", { className: "btn btn-secondary btn-sm", disabled: ev.liquidado, onClick: () => {
        updateItem('eventRequests', ev.id, { liquidado: true });
        if (ev.folio) {const tk = state.tickets.find((t) => t.folio === ev.folio);if (tk) updateItem('tickets', tk.id, { estadoPago: 'Pago confirmado (100%)' });}
      } }, ev.liquidado ? '✅ Liquidado' : 'Marcar resto pagado')
    ),
    ev.estado !== 'rechazada' && /*#__PURE__*/React.createElement("button", { className: "btn btn-ghost btn-sm", style: { marginTop: 8 }, onClick: () => abrirCotizacion(ev) }, ev.estado === 'pendiente' ? '💬 Cotizar' : '✏️ Editar cotización')
    );
  }),
  solicitudesFiltradas.length === 0 && /*#__PURE__*/React.createElement("p", { className: "small" }, "Sin solicitudes en este filtro.")
  ),

  cotizando && /*#__PURE__*/React.createElement(Modal, { title: 'Cotización de ' + cotizando.nombre, onClose: () => setCotizando(null), wide: true }, /*#__PURE__*/
  React.createElement("div", { className: "small", style: { marginBottom: 10 } }, fmtDate(cotizando.fecha), " ", cotizando.hora, " \xB7 ", cotizando.ubicacion, " \xB7 ", cotizando.personas, " personas \xB7 \uD83D\uDCDE ", cotizando.telefono), /*#__PURE__*/
  React.createElement("table", { style: { marginBottom: 14 } }, /*#__PURE__*/
  React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Bebida"), /*#__PURE__*/React.createElement("th", null, "Sabor"), /*#__PURE__*/React.createElement("th", null, "Cant."), /*#__PURE__*/React.createElement("th", null, "Precio unitario"), /*#__PURE__*/React.createElement("th", null, "Subtotal"))), /*#__PURE__*/
  React.createElement("tbody", null, itemsEdit.map((i) => {
    const nombre = i.nombreLibre || state.bebidasEvento.find((b) => b.id === i.bebidaId)?.nombre || 'Bebida';
    const subtotal = (Number(i.precioUnitarioFinal) || 0) * i.cantidad;
    return /*#__PURE__*/React.createElement("tr", { key: i.id }, /*#__PURE__*/
    React.createElement("td", null, nombre), /*#__PURE__*/React.createElement("td", null, i.sabor || '—'), /*#__PURE__*/React.createElement("td", null, i.cantidad), /*#__PURE__*/
    React.createElement("td", null, /*#__PURE__*/React.createElement("input", { type: "number", style: { maxWidth: 90 }, value: i.precioUnitarioFinal, onChange: (e) => actualizarPrecioItem(i.id, e.target.value) })), /*#__PURE__*/
    React.createElement("td", null, money(subtotal))
    );
  }))
  ), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { fontWeight: 800, fontSize: 20, marginBottom: 14 } }, /*#__PURE__*/React.createElement("span", null, "Total cotizado"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", null, money(totalCotizadoLive))), /*#__PURE__*/

  React.createElement("div", { className: "card", style: { background: 'var(--bg-soft)', marginBottom: 14 } }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { marginBottom: 8 } },
  ['pct', 'monto'].map((m) => /*#__PURE__*/React.createElement("button", { key: m, className: 'pill ' + (modoAnticipo === m ? 'active' : ''), onClick: () => setModoAnticipo(m) }, m === 'pct' ? 'Por porcentaje' : 'Monto libre'))
  ),
  modoAnticipo === 'pct' ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/
  React.createElement(Field, { label: "Porcentaje de anticipo" }, /*#__PURE__*/React.createElement("select", { value: anticipoPct, onChange: (e) => setAnticipoPct(Number(e.target.value)) }, /*#__PURE__*/
  React.createElement("option", { value: 10 }, "10%"), /*#__PURE__*/React.createElement("option", { value: 25 }, "25%"), /*#__PURE__*/React.createElement("option", { value: 50 }, "50%"), /*#__PURE__*/React.createElement("option", { value: 100 }, "100% (pago completo)")
  )), /*#__PURE__*/
  React.createElement("div", { className: "small", style: { marginTop: 6 } }, "Anticipo calculado: ", /*#__PURE__*/React.createElement("strong", null, money(anticipoFinal)))
  ) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/
  React.createElement(Field, { label: "Monto de anticipo" }, /*#__PURE__*/React.createElement("input", { type: "number", value: anticipoMonto, onChange: (e) => setAnticipoMonto(e.target.value) })), /*#__PURE__*/
  React.createElement("div", { className: "small", style: { marginTop: 6 } }, "Equivale a: ", /*#__PURE__*/React.createElement("strong", null, anticipoPctEquivalente, "%"), " del total")
  )
  ), /*#__PURE__*/

  React.createElement("div", { className: "flexrow", style: { flexWrap: 'wrap' } }, /*#__PURE__*/
  React.createElement("button", { className: "btn btn-secondary", onClick: guardarCotizacion }, "\uD83D\uDCBE Guardar cotizaci\xF3n"), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", onClick: aprobar }, "\u2705 Aprobar y generar folio"), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-ghost", onClick: rechazar }, "\u274C Rechazar solicitud")
  )
  )
  );
}

function AdminBebidasEvento() {
  const { state, setState, toast, log } = useStore();
  const [nombre, setNombre] = useState('');const [precio, setPrecio] = useState('');const [aceptaSabor, setAceptaSabor] = useState(false);
  function agregar() {
    if (!nombre.trim() || !precio) {toast('Escribe el nombre y el precio de referencia');return;}
    setState((s) => ({ ...s, bebidasEvento: [...s.bebidasEvento, { id: uid('beb'), nombre: nombre.trim(), precio_referencia: Number(precio), acepta_sabor: aceptaSabor, activo: true }] }));
    log('Administrador', 'Agregó bebida de evento: ' + nombre.trim());
    toast('✅ Bebida agregada al catálogo de eventos');
    setNombre('');setPrecio('');setAceptaSabor(false);
  }
  function actualizarPrecio(id, valor) {setState((s) => ({ ...s, bebidasEvento: s.bebidasEvento.map((b) => b.id === id ? { ...b, precio_referencia: Number(valor) } : b) }));}
  function toggleActivo(b) {setState((s) => ({ ...s, bebidasEvento: s.bebidasEvento.map((x) => x.id === b.id ? { ...x, activo: !x.activo } : x) }));toast(b.activo ? '🔴 Bebida desactivada' : '🟢 Bebida activada');}
  function toggleSabor(b) {setState((s) => ({ ...s, bebidasEvento: s.bebidasEvento.map((x) => x.id === b.id ? { ...x, acepta_sabor: !x.acepta_sabor } : x) }));}
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Cat\xE1logo de bebidas para eventos"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Administra qu\xE9 bebidas puede elegir el cliente al solicitar un evento \u2014 agrega nuevas, ajusta el precio de referencia o desactiva las que ya no se ofrecen."), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginBottom: 16 } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Agregar bebida"), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-4" }, /*#__PURE__*/
  React.createElement("input", { placeholder: "Nombre", value: nombre, onChange: (e) => setNombre(e.target.value) }), /*#__PURE__*/
  React.createElement("input", { placeholder: "Precio de referencia", type: "number", value: precio, onChange: (e) => setPrecio(e.target.value) }), /*#__PURE__*/
  React.createElement("label", { className: "flexrow" }, /*#__PURE__*/React.createElement("input", { type: "checkbox", style: { width: 'auto' }, checked: aceptaSabor, onChange: (e) => setAceptaSabor(e.target.checked) }), /*#__PURE__*/React.createElement("span", { className: "small" }, "Acepta sabor")), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", onClick: agregar }, "+ Agregar")
  )
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("table", null, /*#__PURE__*/
  React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Bebida"), /*#__PURE__*/React.createElement("th", null, "Precio de referencia"), /*#__PURE__*/React.createElement("th", null, "Acepta sabor"), /*#__PURE__*/React.createElement("th", null, "Estado"))), /*#__PURE__*/
  React.createElement("tbody", null, state.bebidasEvento.map((b) => /*#__PURE__*/React.createElement("tr", { key: b.id }, /*#__PURE__*/
  React.createElement("td", null, b.nombre), /*#__PURE__*/
  React.createElement("td", null, /*#__PURE__*/React.createElement("input", { type: "number", style: { maxWidth: 90 }, value: b.precio_referencia, onChange: (e) => actualizarPrecio(b.id, e.target.value) })), /*#__PURE__*/
  React.createElement("td", null, /*#__PURE__*/React.createElement("input", { type: "checkbox", checked: b.acepta_sabor, onChange: () => toggleSabor(b) })), /*#__PURE__*/
  React.createElement("td", null, /*#__PURE__*/React.createElement("button", { className: 'btn btn-sm ' + (b.activo ? 'btn-ghost' : 'btn-primary'), onClick: () => toggleActivo(b) }, b.activo ? '🟢 Activa (clic para desactivar)' : '🔴 Desactivada (clic para activar)'))
  )))
  )
  )
  );
}

function AdminTickets() {
  const { state } = useStore();
  const filas = state.eventRequests.filter((ev) => ev.folio).map((ev) => ({
    id: ev.id, folio: ev.folio, cliente: ev.nombre, fecha: ev.fecha,
    total: ev.totalCotizado, anticipo: ev.anticipoMonto || 0,
    estadoAnticipo: ev.anticipoPagado ? 'Confirmado' : 'Pendiente', estado: ev.estado
  }));
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, "Historial de eventos con folio"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Resumen de eventos ya aprobados: folio, total cotizado, anticipo y su estado."), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/React.createElement(DataTable, { emptyText: "Sin eventos con folio a\xFAn.", columns: [
    { key: 'folio', label: 'Folio' }, { key: 'cliente', label: 'Cliente' }, { key: 'fecha', label: 'Fecha' },
    { key: 'total', label: 'Total cotizado', render: (r) => money(r.total) },
    { key: 'anticipo', label: 'Anticipo', render: (r) => money(r.anticipo) },
    { key: 'estadoAnticipo', label: 'Anticipo', render: (r) => /*#__PURE__*/React.createElement("span", { className: 'tag ' + (r.estadoAnticipo === 'Confirmado' ? 'ok' : 'warn') }, r.estadoAnticipo) },
    { key: 'estado', label: 'Estado' }],
    rows: filas }))
  );
}

function AdminReposicion() {
  const { state, updateItem, toast, log } = useStore();
  const [verReporte, setVerReporte] = useState(null);
  const pendientes = state.shiftCloseReports.filter((r) => r.estado === 'pendiente');

  function aprobar(r) {
    updateItem('shiftCloseReports', r.id, { estado: 'aprobado' });
    log('Administrador', 'Aprobó reporte de reposición del ' + r.fecha);
    toast('✅ Reporte aprobado y convertido en orden de compra (simulado)');
  }

  const conteoPorProducto = {};
  state.shiftCloseReports.forEach((r) => r.items.forEach((i) => {if (i.necesitaReposicion) conteoPorProducto[i.nombre] = (conteoPorProducto[i.nombre] || 0) + 1;}));
  const ranking = Object.entries(conteoPorProducto).sort((a, b) => b[1] - a[1]);

  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Reportes de reposici\xF3n (cierres de turno)"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Cada vez que el bartender cierra su turno, si alg\xFAn producto qued\xF3 por debajo del m\xEDnimo, aparece aqu\xED para que apruebes la reposici\xF3n."), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginBottom: 16 } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Pendientes de aprobar"),
  pendientes.length === 0 && /*#__PURE__*/React.createElement("p", { className: "small" }, "Sin reportes pendientes."),
  pendientes.map((r) => /*#__PURE__*/React.createElement("div", { key: r.id, className: "card", style: { marginBottom: 10, background: 'var(--bg-soft)' } }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow" }, /*#__PURE__*/React.createElement("strong", null, fmtDate(r.fecha), " ", r.hora), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", { className: "small" }, "Cerr\xF3: ", r.bartender)),
  r.items.filter((i) => i.necesitaReposicion).map((i) => /*#__PURE__*/React.createElement("div", { key: i.nombre, className: "small" }, "\uD83D\uDD34 ", i.nombre, ": quedan ", i.cantidad, ", m\xEDnimo ", i.minimo, " \u2014 faltan ", /*#__PURE__*/React.createElement("strong", null, i.faltante))), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary btn-sm", style: { marginTop: 8 }, onClick: () => aprobar(r) }, "\u2705 Aprobar y generar orden de compra")
  ))
  ), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginBottom: 16 } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Productos que m\xE1s se agotan"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Cuenta cu\xE1ntas veces cada producto ha quedado por debajo del m\xEDnimo en los cierres de turno \u2014 \xFAtil para detectar qu\xE9 se agota m\xE1s r\xE1pido."), /*#__PURE__*/
  React.createElement(DataTable, { emptyText: "A\xFAn no hay suficiente historial.", columns: [{ key: 'producto', label: 'Producto' }, { key: 'veces', label: 'Veces por debajo del mínimo' }], rows: ranking.map(([producto, veces]) => ({ id: producto, producto, veces })) })
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Historial completo de cierres"), /*#__PURE__*/
  React.createElement(DataTable, { emptyText: "Sin cierres registrados.", columns: [
    { key: 'fecha', label: 'Fecha' }, { key: 'hora', label: 'Hora' }, { key: 'bartender', label: 'Bartender' },
    { key: 'pendientes', label: 'Productos a reponer', render: (r) => r.items.filter((i) => i.necesitaReposicion).length },
    { key: 'estado', label: 'Estado', render: (r) => /*#__PURE__*/React.createElement("span", { className: 'tag ' + (r.estado === 'aprobado' ? 'ok' : r.estado === 'sin_pendientes' ? 'ok' : 'warn') }, r.estado === 'aprobado' ? 'Aprobado' : r.estado === 'sin_pendientes' ? 'Sin pendientes' : 'Pendiente') }],
    rows: [...state.shiftCloseReports].reverse(), onView: (r) => setVerReporte(r) })
  ),
  verReporte && /*#__PURE__*/React.createElement(Modal, { title: 'Cierre de turno — ' + fmtDate(verReporte.fecha), onClose: () => setVerReporte(null) }, /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Bartender:"), " ", verReporte.bartender), /*#__PURE__*/
  React.createElement("hr", { className: "line" }),
  verReporte.items.map((i) => /*#__PURE__*/React.createElement("div", { key: i.nombre, className: "flexrow small", style: { marginBottom: 4 } }, /*#__PURE__*/
  React.createElement("span", null, i.nombre), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", null, i.cantidad, " / m\xEDn. ", i.minimo),
  i.necesitaReposicion && /*#__PURE__*/React.createElement("span", { className: "tag danger", style: { marginLeft: 6 } }, "Reponer")
  ))
  )
  );
}
// El admin define aquí los datos de la cuenta bancaria para recibir transferencias. Se reflejan automáticamente
// al cliente (al elegir pagar por transferencia), y al Mesero/Cantinero (en "Registrar venta") para que puedan
// dárselos al cliente en persona o verificar un pago.
function AdminCuentaBancaria() {
  const { state, setState, log, toast } = useStore();
  const cuenta = state.transferAccount || TRANSFER_ACCOUNT_SEED;
  const [form, setForm] = useState(cuenta);
  function guardar() {
    setState({ transferAccount: { ...form } });
    log('Administrador', 'Actualizó los datos de la cuenta bancaria para transferencias');
    toast('✅ Cuenta bancaria actualizada — ya se refleja para el cliente, el mesero y el bartender');
  }
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "\uD83C\uDFE6 Cuenta bancaria para transferencias"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Estos datos son los que ve el cliente cuando elige pagar por transferencia, y tambi\xE9n el Mesero y el Cantinero en \"Registrar venta\" para poder d\xE1rselos al cliente o verificar su pago."), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { maxWidth: 480 } }, /*#__PURE__*/
  React.createElement(Field, { label: "Titular de la cuenta" }, /*#__PURE__*/React.createElement("input", { value: form.titular, onChange: (e) => setForm({ ...form, titular: e.target.value }) })), /*#__PURE__*/
  React.createElement(Field, { label: "Banco" }, /*#__PURE__*/React.createElement("input", { value: form.banco, onChange: (e) => setForm({ ...form, banco: e.target.value }) })), /*#__PURE__*/
  React.createElement(Field, { label: "CLABE interbancaria" }, /*#__PURE__*/React.createElement("input", { value: form.clabe, onChange: (e) => setForm({ ...form, clabe: e.target.value }) })), /*#__PURE__*/
  React.createElement(Field, { label: "N\xFAmero de cuenta" }, /*#__PURE__*/React.createElement("input", { value: form.cuenta, onChange: (e) => setForm({ ...form, cuenta: e.target.value }) })), /*#__PURE__*/
  React.createElement(Field, { label: "N\xFAmero de tarjeta (opcional)" }, /*#__PURE__*/React.createElement("input", { value: form.tarjeta || '', onChange: (e) => setForm({ ...form, tarjeta: e.target.value }) })), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", style: { marginTop: 10 }, onClick: guardar }, "\uD83D\uDCBE Guardar cambios")
  ), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { maxWidth: 480, marginTop: 14, background: 'var(--bg-soft)' } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Vista previa (lo que ven cliente/mesero/bartender)"), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Titular:"), " ", cuenta.titular), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Banco:"), " ", cuenta.banco), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "CLABE:"), " ", cuenta.clabe), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "N\xFAmero de cuenta:"), " ", cuenta.cuenta),
  cuenta.tarjeta && /*#__PURE__*/React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Tarjeta:"), " ", cuenta.tarjeta)
  )
  );
}
// Historial completo de cortes de caja — SOLO visible para el Admin. Los cortes ya confirmados son de solo
// lectura (sin editar/eliminar); el admin únicamente puede adjuntar una nota de corrección sin tocar el original.
function AdminCortesCaja() {
  const { state, setState, log, toast } = useStore();
  const [verDetalle, setVerDetalle] = useState(null);
  const [notaTexto, setNotaTexto] = useState('');
  const [limiteTmp, setLimiteTmp] = useState(String(state.limiteDiferenciaCorte || 200));

  function guardarLimite() {
    const nuevo = Math.max(0, Number(limiteTmp) || 0);
    setState({ limiteDiferenciaCorte: nuevo });
    log('Administrador', 'Cambió el límite de diferencia aceptable del corte de caja a ' + money(nuevo));
    toast('✅ Límite actualizado a ' + money(nuevo));
  }
  function agregarNota(cut) {
    if (!notaTexto.trim()) {toast('Escribe la nota de corrección');return;}
    const nota = { fecha: todayISO(), hora: nowTime(), texto: notaTexto.trim(), por: 'Administrador' };
    setState((s) => ({ ...s, cashCuts: s.cashCuts.map((c) => c.id !== cut.id ? c : { ...c, notasCorreccion: [...(c.notasCorreccion || []), nota] }) }));
    log('Administrador', 'Agregó nota de corrección al corte de caja del ' + cut.fecha + ' (' + cut.bartenderNombre + ')');
    toast('✅ Nota de corrección adjuntada — el corte original no se modificó');
    setNotaTexto('');
    setVerDetalle((v) => v && { ...v, notasCorreccion: [...(v.notasCorreccion || []), nota] });
  }

  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "\uD83E\uDDEE Cortes de caja"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Historial completo \u2014 solo visible para el administrador. Un corte ya confirmado nunca se puede editar ni eliminar (ni siquiera por aqu\xED); si hubo un error, agrega una nota de correcci\xF3n que queda adjunta al corte original."), /*#__PURE__*/

  React.createElement("div", { className: "card", style: { maxWidth: 420, marginBottom: 16 } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "L\xEDmite de diferencia aceptable"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Si la diferencia del corte supera este monto, el bartender debe escribir una nota obligatoria antes de poder cerrarlo."), /*#__PURE__*/
  React.createElement(Field, { label: "L\xEDmite ($)" }, /*#__PURE__*/React.createElement("input", { type: "number", value: limiteTmp, onChange: (e) => setLimiteTmp(e.target.value) })), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary btn-sm", onClick: guardarLimite }, "Guardar")
  ), /*#__PURE__*/

  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement(DataTable, { emptyText: "Sin cortes de caja registrados.", columns: [
    { key: 'fecha', label: 'Fecha' }, { key: 'hora', label: 'Hora' }, { key: 'bartenderNombre', label: 'Bartender' },
    { key: 'ventasEfectivo', label: 'Ventas efvo.', render: (r) => money(r.ventasEfectivo) },
    { key: 'ventasTransferencia', label: 'Ventas transf.', render: (r) => money(r.ventasTransferencia) },
    { key: 'efectivoContado', label: 'Contado', render: (r) => money(r.efectivoContado) },
    { key: 'diferencia', label: 'Diferencia', render: (r) => /*#__PURE__*/React.createElement("span", { className: 'tag ' + (r.diferencia === 0 ? 'ok' : Math.abs(r.diferencia) <= (state.limiteDiferenciaCorte || 200) ? 'warn' : 'danger') }, money(r.diferencia)) },
    { key: 'notas', label: 'Notas', render: (r) => r.notasCorreccion && r.notasCorreccion.length ? /*#__PURE__*/React.createElement("span", { className: "tag warn" }, r.notasCorreccion.length, " nota(s)") : '—' },
    { key: 'pdf', label: 'PDF', render: (r) => /*#__PURE__*/React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => generarPDFCorteCaja(r) }, "\uD83D\uDCC4") },
    { key: 'excel', label: 'Excel', render: (r) => /*#__PURE__*/React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => generarExcelCorteCaja(r) }, "\uD83D\uDCE5") }],
    rows: [...state.cashCuts].reverse(), onView: (r) => setVerDetalle(r) })
  ),

  verDetalle && /*#__PURE__*/React.createElement("div", { className: "modal-bg", onClick: () => setVerDetalle(null) }, /*#__PURE__*/
  React.createElement("div", { className: "modal", onClick: (e) => e.stopPropagation() }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Corte de caja \u2014 ", verDetalle.fecha, " ", verDetalle.hora), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Bartender:"), " ", verDetalle.bartenderNombre), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Fondo inicial:"), " ", money(verDetalle.fondoInicial)), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Ventas efectivo:"), " ", money(verDetalle.ventasEfectivo)), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Ventas transferencia:"), " ", money(verDetalle.ventasTransferencia)), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Efectivo esperado:"), " ", money(verDetalle.efectivoEsperado)), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Efectivo contado:"), " ", money(verDetalle.efectivoContado)), /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, "Diferencia:"), " ", money(verDetalle.diferencia)),
  verDetalle.notaJustificacion && /*#__PURE__*/React.createElement("div", { className: "small", style: { marginTop: 6 } }, "\uD83D\uDCDD ", /*#__PURE__*/React.createElement("strong", null, "Nota del bartender:"), " ", verDetalle.notaJustificacion),
  verDetalle.notasCorreccion && verDetalle.notasCorreccion.length > 0 && /*#__PURE__*/React.createElement("div", { style: { marginTop: 10 } }, /*#__PURE__*/
  React.createElement("strong", { className: "small" }, "Notas de correcci\xF3n:"),
  verDetalle.notasCorreccion.map((n, i) => /*#__PURE__*/React.createElement("div", { key: i, className: "small", style: { marginTop: 4 } }, "\u2022 (", n.fecha, " ", n.hora, ") ", n.texto))
  ), /*#__PURE__*/
  React.createElement("div", { style: { marginTop: 14 } }, /*#__PURE__*/
  React.createElement(Field, { label: "Agregar nota de correcci\xF3n" }, /*#__PURE__*/React.createElement("textarea", { rows: 2, value: notaTexto, onChange: (e) => setNotaTexto(e.target.value), placeholder: "Ej. se confirm\xF3 con el bartender que el faltante fue por un error al dar cambio en la venta X." })), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary btn-sm", onClick: () => agregarNota(verDetalle) }, "\u2795 Adjuntar nota")
  ), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { gap: 8, marginTop: 14 } }, /*#__PURE__*/
  React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => generarPDFCorteCaja(verDetalle) }, "\uD83D\uDCC4 PDF"), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => generarExcelCorteCaja(verDetalle) }, "\uD83D\uDCE5 Excel"), /*#__PURE__*/
  React.createElement("span", { className: "spacer" }), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => setVerDetalle(null) }, "Cerrar")
  )
  )
  )
  );
}
function AdminTransferPendientes() {
  const { state, updateItem, log, toast } = useStore();
  const pendientes = state.tickets.filter((t) => t.estadoPago === 'Transferencia pendiente de verificar');
  function aprobar(t) {
    updateItem('tickets', t.id, { estadoPago: 'Pago confirmado' });
    if (t.tipoPedido === 'Evento') {
      const ev = state.eventRequests.find((e) => e.folio === t.folio);
      if (ev) updateItem('eventRequests', ev.id, { anticipoPagado: true });
    }
    log('Administrador', 'Aprobó transferencia ' + t.folio);toast('🟢 Pago confirmado: ' + t.folio);
  }
  function rechazar(t) {updateItem('tickets', t.id, { estadoPago: 'Transferencia rechazada' });log('Administrador', 'Rechazó transferencia ' + t.folio);toast('❌ Transferencia rechazada: ' + t.folio);}
  function pedirComprobante(t) {updateItem('tickets', t.id, { estadoPago: 'Transferencia pendiente de verificar', comprobante: null });toast('📎 Se solicitó nuevamente el comprobante para ' + t.folio);}
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Transferencias pendientes de verificar"),
  pendientes.length === 0 && /*#__PURE__*/React.createElement("p", { className: "small" }, "No hay transferencias pendientes."),
  pendientes.map((t) => /*#__PURE__*/React.createElement("div", { key: t.id, className: "card", style: { marginBottom: 10 } }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow" }, /*#__PURE__*/React.createElement("strong", null, t.folio), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", { className: "tag warn" }, "\uD83D\uDFE1 Pendiente")), /*#__PURE__*/
  React.createElement("div", { className: "small" }, "Cliente: ", t.clienteNombre || 'Mostrador', " (", t.clienteEmail || '—', ")"), /*#__PURE__*/
  React.createElement("div", { className: "small" }, "Monto: ", money(t.total), " \xB7 Comprobante: ", t.comprobante || 'Sin adjuntar'), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { marginTop: 8 } }, /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary btn-sm", onClick: () => aprobar(t) }, "Aprobar pago"), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => rechazar(t) }, "Rechazar"), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: () => pedirComprobante(t) }, "Solicitar comprobante de nuevo")
  )
  ))
  );
}

// Cierre semanal de nómina: calcula ganancias de la semana, propone el pago de cada empleado según su salario
// registrado, y al confirmar descuenta la nómina de las ganancias y guarda el historial de pagos semanales.
// Días trabajados "automáticos" de la semana: parte de los 7 días que opera el negocio y resta los días en
// los que el empleado avisó "Faltaré hoy" (turnos registrados en Asistencia) dentro del rango de la semana.
function diasAutomaticosSemana(state, empleadoNombre, semana) {
  const DIAS_SEMANA_NEGOCIO = 7;
  const faltas = state.attendanceNotices.filter((a) => a.empleado === empleadoNombre && a.tipo === 'falta' && a.fecha >= semana.inicio && a.fecha <= semana.fin).length;
  return Math.max(0, DIAS_SEMANA_NEGOCIO - faltas);
}
function AdminNomina() {
  const { state, setState, updateItem, log, toast } = useStore();
  const semana = rangoSemanaActual();
  const [editando, setEditando] = useState(null); // staffId cuyo salario se está editando
  const [salarioTmp, setSalarioTmp] = useState('');
  const [verDetalle, setVerDetalle] = useState(null); // pago histórico a expandir
  const [diasEditados, setDiasEditados] = useState({}); // {staffId: días} — override manual antes de confirmar

  const empleados = state.staff.filter((s) => !(s.esPrueba && s.estadoPrueba === 'activo'));
  const yaCerrada = state.nominaPagos.some((p) => p.semanaInicio === semana.inicio);
  const ganancias = state.sales.filter((s) => s.estadoPedido !== 'Cancelado' && s.fecha >= semana.inicio && s.fecha <= semana.fin).reduce((a, s) => a + s.total, 0);
  function diasDe(emp) {return diasEditados[emp.id] != null ? diasEditados[emp.id] : diasAutomaticosSemana(state, emp.nombre, semana);}
  function montoDe(emp) {return Math.round((Number(emp.salarioSemanal) || 0) / 7 * diasDe(emp));}
  const nominaTotal = empleados.reduce((a, e) => a + montoDe(e), 0);
  const faltante = nominaTotal - ganancias;

  function guardarSalario(emp) {
    updateItem('staff', emp.id, { salarioSemanal: Number(salarioTmp) || 0 });
    toast('✅ Salario semanal de ' + emp.nombre + ' actualizado');
    setEditando(null);
  }
  function cambiarDias(emp, valor) {
    const dias = Math.max(0, Math.min(7, Number(valor) || 0));
    setDiasEditados((d) => ({ ...d, [emp.id]: dias }));
  }
  function cerrarSemana() {
    const pagos = empleados.map((e) => ({ staffId: e.id, nombre: e.nombre, rol: e.rol, diasTrabajados: diasDe(e), monto: montoDe(e) }));
    const registro = { id: uid('nom'), semanaInicio: semana.inicio, semanaFin: semana.fin, fechaCierre: todayISO(), horaCierre: nowTime(), ganancias, nominaTotal, faltante: Math.max(0, faltante), pagos, cerradoPor: 'Administrador' };
    setState((s) => ({ ...s, nominaPagos: [...s.nominaPagos, registro] }));
    log('Administrador', 'Cerró la semana ' + semana.inicio + ' a ' + semana.fin + ' y pagó nómina por ' + money(nominaTotal));
    toast('✅ Semana cerrada — nómina pagada: ' + money(nominaTotal));
    setDiasEditados({});
  }

  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "\uD83D\uDCB5 N\xF3mina semanal"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Semana actual: ", /*#__PURE__*/React.createElement("strong", null, fmtDate(semana.inicio), " \u2013 ", fmtDate(semana.fin))), /*#__PURE__*/

  React.createElement("div", { className: "grid grid-3", style: { marginBottom: 14 } }, /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/React.createElement("div", { className: "small" }, "Ganancias de la semana"), /*#__PURE__*/React.createElement("div", { style: { fontSize: 22, fontWeight: 800 } }, money(ganancias))), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/React.createElement("div", { className: "small" }, "N\xF3mina total a pagar"), /*#__PURE__*/React.createElement("div", { style: { fontSize: 22, fontWeight: 800 } }, money(nominaTotal))), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/React.createElement("div", { className: "small" }, "Queda despu\xE9s de pagar"), /*#__PURE__*/React.createElement("div", { style: { fontSize: 22, fontWeight: 800, color: ganancias - nominaTotal < 0 ? 'var(--danger)' : 'var(--ok)' } }, money(ganancias - nominaTotal)))
  ),

  faltante > 0 && /*#__PURE__*/React.createElement("div", { className: "alert danger", style: { marginBottom: 14 } }, "\uD83D\uDEA8 ", /*#__PURE__*/React.createElement("strong", null, "Las ganancias de la semana no alcanzan para cubrir la n\xF3mina completa."), " Falta ", money(faltante), " para cubrirla."), /*#__PURE__*/

  React.createElement("div", { className: "card", style: { marginBottom: 14 } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Empleados, d\xEDas trabajados y salario semanal"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Los d\xEDas se calculan autom\xE1ticamente (7 por semana, menos las faltas registradas en Asistencia). Si alguien lleg\xF3 pero no qued\xF3 registrado en el sistema, o hubo alg\xFAn error, puedes corregir el n\xFAmero de d\xEDas aqu\xED antes de confirmar el pago \u2014 despu\xE9s de cerrar la semana ya no se puede modificar."), /*#__PURE__*/
  React.createElement(DataTable, { columns: [
    { key: 'nombre', label: 'Empleado' }, { key: 'rol', label: 'Rol' },
    { key: 'salarioSemanal', label: 'Salario semanal (7 días)', render: (r) => editando === r.id ? /*#__PURE__*/
      React.createElement("span", { className: "flexrow", style: { gap: 6 } }, /*#__PURE__*/React.createElement("input", { type: "number", style: { width: 110 }, value: salarioTmp, onChange: (e) => setSalarioTmp(e.target.value) }), /*#__PURE__*/React.createElement("button", { className: "btn btn-primary btn-sm", onClick: () => guardarSalario(r) }, "Guardar")) : /*#__PURE__*/
      React.createElement("span", { className: "flexrow", style: { gap: 8 } }, money(r.salarioSemanal || 0), /*#__PURE__*/React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => {setEditando(r.id);setSalarioTmp(String(r.salarioSemanal || 0));} }, "\u270F\uFE0F")) },
    { key: 'dias', label: 'Días trabajados', render: (r) => yaCerrada ?
      diasDe(r) + ' días' : /*#__PURE__*/
      React.createElement("input", { type: "number", min: "0", max: "7", style: { width: 70 }, value: diasDe(r), onChange: (e) => cambiarDias(r, e.target.value) }) },
    { key: 'monto', label: 'A pagar esta semana', render: (r) => money(montoDe(r)) }],
    rows: empleados })
  ),

  yaCerrada ? /*#__PURE__*/
  React.createElement("div", { className: "alert", style: { marginBottom: 14 } }, "\u2705 La semana actual ya fue cerrada y pagada.") : /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", onClick: cerrarSemana }, "\uD83D\uDCB5 Cerrar semana y pagar n\xF3mina"), /*#__PURE__*/

  React.createElement("h3", { style: { marginTop: 26 } }, "Historial de pagos semanales"), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/React.createElement(DataTable, { emptyText: "Sin cierres de n\xF3mina a\xFAn.", columns: [
    { key: 'semanaInicio', label: 'Semana', render: (r) => fmtDate(r.semanaInicio) + ' – ' + fmtDate(r.semanaFin) },
    { key: 'ganancias', label: 'Ganancias', render: (r) => money(r.ganancias) },
    { key: 'nominaTotal', label: 'Nómina pagada', render: (r) => money(r.nominaTotal) },
    { key: 'faltante', label: 'Faltante', render: (r) => r.faltante > 0 ? /*#__PURE__*/React.createElement("span", { className: "tag danger" }, money(r.faltante)) : '—' },
    { key: 'fechaCierre', label: 'Fecha de cierre', render: (r) => fmtDate(r.fechaCierre) }],
    rows: [...state.nominaPagos].reverse(), onView: (r) => setVerDetalle(r) })),

  verDetalle && /*#__PURE__*/React.createElement("div", { className: "modal-bg", onClick: () => setVerDetalle(null) }, /*#__PURE__*/
  React.createElement("div", { className: "modal", onClick: (e) => e.stopPropagation() }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Detalle de pago \u2014 ", fmtDate(verDetalle.semanaInicio), " a ", fmtDate(verDetalle.semanaFin)), /*#__PURE__*/
  React.createElement(DataTable, { columns: [{ key: 'nombre', label: 'Empleado' }, { key: 'rol', label: 'Rol' }, { key: 'diasTrabajados', label: 'Días trabajados', render: (r) => (r.diasTrabajados != null ? r.diasTrabajados : 7) + ' días' }, { key: 'monto', label: 'Monto', render: (r) => money(r.monto) }], rows: verDetalle.pagos }), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { marginTop: 10, fontWeight: 800 } }, /*#__PURE__*/React.createElement("span", null, "Total pagado"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", null, money(verDetalle.nominaTotal))), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-ghost btn-sm", style: { marginTop: 10 }, onClick: () => setVerDetalle(null) }, "Cerrar")
  )
  )
  );
}
// --- Apertura/Cierre del negocio (Bartender tiene control total; Admin puede forzarlo en emergencia) ---
// Botón grande reutilizable: cuando el negocio se cierra, se bloquean TODOS los pedidos nuevos (cliente y mesero).
function BotonAperturaNegocio({ quien, compacto }) {
  const { state, setState, notify, log, toast } = useStore();
  const abierto = state.negocioAbierto !== false;
  const [confirmando, setConfirmando] = useState(false);

  function ejecutar() {
    const nuevo = !abierto;
    setState({ negocioAbierto: nuevo, negocioUltimoCambio: { hora: nowTime(), fecha: todayISO(), por: quien } });
    log(quien, (nuevo ? 'Abrió' : 'Cerró') + ' el negocio');
    notify({ tipo: 'negocio_estado', estado: nuevo ? 'abierto' : 'cerrado', por: quien });
    toast(nuevo ? '🟢 Negocio abierto — ya se pueden tomar pedidos' : '🔴 Negocio cerrado por hoy — se bloquearon todos los pedidos nuevos');
    setConfirmando(false);
  }

  return /*#__PURE__*/React.createElement("div", { className: "card", style: compacto ? { maxWidth: 420, margin: '0 auto 16px', textAlign: 'center' } : { marginBottom: 16, textAlign: 'center' } }, /*#__PURE__*/
  React.createElement("div", { className: 'tag ' + (abierto ? 'ok' : 'danger'), style: { fontSize: 14, padding: '6px 14px' } },
  abierto ? '🟢 Negocio abierto' : '🔴 Negocio cerrado', state.negocioUltimoCambio ? ' — desde las ' + state.negocioUltimoCambio.hora + ' (' + state.negocioUltimoCambio.por + ')' : ''
  ),
  !confirmando ?
  compacto ? /*#__PURE__*/
  React.createElement("button", { className: 'btn ' + (abierto ? 'btn-secondary' : 'btn-primary'), style: { marginTop: 14 }, onClick: () => setConfirmando(true) }, abierto ? '🔴 Cerrar negocio' : '🟢 Abrir negocio') : /*#__PURE__*/
  React.createElement("button", { className: 'btn btn-lg ' + (abierto ? 'btn-secondary' : 'btn-primary'), style: { marginTop: 14, width: '100%', padding: '18px', fontSize: 18, fontWeight: 800 }, onClick: () => setConfirmando(true) },
  abierto ? '🔴 Cerrar negocio' : '🟢 Abrir negocio'
  ) : /*#__PURE__*/
  React.createElement("div", { style: { marginTop: 14 } }, /*#__PURE__*/
  React.createElement("p", { className: "small" }, abierto ? '¿Confirmas cerrar el negocio? Se bloquearán de inmediato todos los pedidos nuevos de clientes y meseros con el mensaje "El negocio está cerrado por hoy, vuelve mañana".' : '¿Confirmas abrir el negocio ahora? Todo volverá a estar disponible.'), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { justifyContent: 'center', gap: 10 } }, /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary btn-sm", onClick: ejecutar }, "S\xED, confirmar"), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => setConfirmando(false) }, "Cancelar")
  )
  )
  );
}
function AdminNegocio() {
  const { state } = useStore();
  const abierto = state.negocioAbierto !== false;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "\uD83D\uDD11 Apertura/Cierre del negocio"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "El Cantinero tiene el control principal desde su panel para abrir o cerrar el sistema en el horario establecido. Desde aqu\xED puedes forzarlo tambi\xE9n en caso de emergencia \u2014 recibir\xE1s una notificaci\xF3n cada vez que se abra o cierre, con la hora exacta y qui\xE9n lo hizo."), /*#__PURE__*/
  React.createElement(BotonAperturaNegocio, { quien: "Administrador" }),
  !abierto && /*#__PURE__*/React.createElement("div", { className: "alert danger" }, "\uD83D\uDD12 Mientras el negocio est\xE9 cerrado, los clientes ven \"El negocio est\xE1 cerrado por hoy, vuelve ma\xF1ana\" y el Mesero no puede registrar ventas nuevas.")
  );
}
function AdminHistorialPagos() {
  const { state } = useStore();
  const rows = [...state.tickets].reverse();
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Historial de pagos"), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/React.createElement(DataTable, { emptyText: "Sin pagos registrados.", columns: [
    { key: 'folio', label: 'Folio' }, { key: 'fecha', label: 'Fecha' }, { key: 'clienteNombre', label: 'Cliente', render: (r) => r.clienteNombre || 'Mostrador' },
    { key: 'metodoPago', label: 'Método' }, { key: 'estadoPago', label: 'Estado', render: (r) => /*#__PURE__*/React.createElement("span", { className: 'tag ' + ((r.estadoPago || '').includes('confirmado') || (r.estadoPago || '').includes('Pagado') ? 'ok' : (r.estadoPago || '').includes('rechazada') ? 'danger' : 'warn') }, r.estadoPago) },
    { key: 'total', label: 'Total', render: (r) => money(r.total) }],
    rows: rows }))
  );
}

function AdminClientes() {
  const { state } = useStore();
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Cuentas de clientes registrados"), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginBottom: 14 } }, /*#__PURE__*/
  React.createElement(DataTable, { emptyText: "A\xFAn no hay clientes registrados.", columns: [{ key: 'nombre', label: 'Nombre' }, { key: 'email', label: 'Correo' }, { key: 'cumpleanos', label: 'Cumpleaños', render: (r) => r.cumpleanos ? fmtDate(r.cumpleanos) : '—' }, { key: 'creado', label: 'Registrado' }], rows: state.customers })
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Tickets emitidos por cliente"), /*#__PURE__*/
  React.createElement(DataTable, { emptyText: "Sin tickets emitidos.", columns: [{ key: 'folio', label: 'Folio' }, { key: 'clienteNombre', label: 'Cliente' }, { key: 'tipoPedido', label: 'Tipo' }, { key: 'total', label: 'Total', render: (r) => money(r.total) }], rows: [...state.tickets].reverse() })
  )
  );
}

// Animación ligera de decoración de temporada, usada en el hero público cuando un tema activo tiene "decoracion".
// Animación de temporada GLOBAL: cae sobre toda la pantalla sin importar el rol que esté navegando
// (Cliente, Administrador, Bartender, Mesero, Cocinera). Se activa/desactiva junto con el tema de temporada.
function GlobalThemeAnimation() {
  const { temaActivo } = useStore();
  const emojis = useMemo(() => temaActivo ? emojisDeTema(temaActivo) : [], [temaActivo]);
  const drops = useMemo(() => emojis.length ? [...Array(18)].map((_, i) => ({
    id: i, left: Math.random() * 100, delay: Math.random() * 6, dur: 7 + Math.random() * 6,
    emoji: emojis[i % emojis.length], size: 16 + Math.random() * 16
  })) : [], [temaActivo && temaActivo.id]);
  if (!temaActivo || !temaActivo.decoracion || drops.length === 0) return null;
  return /*#__PURE__*/React.createElement("div", { style: { position: 'fixed', inset: 0, zIndex: 9999, pointerEvents: 'none', overflow: 'hidden' } },
  drops.map((d) => /*#__PURE__*/React.createElement("span", { key: d.id, style: { position: 'absolute', left: d.left + '%', top: -30, fontSize: d.size,
      animation: 'fall ' + d.dur + 's linear ' + d.delay + 's infinite' } }, d.emoji)), /*#__PURE__*/
  React.createElement("style", null, '@keyframes fall{0%{transform:translateY(-30px) rotate(0deg);opacity:0;}10%{opacity:.9;}100%{transform:translateY(100vh) rotate(360deg);opacity:0;}}')
  );
}
function ThemeFloatingDecor({ tema }) {
  const emojis = emojisDeTema(tema);
  const drops = useMemo(() => [...Array(14)].map((_, i) => ({
    id: i, left: Math.random() * 100, delay: Math.random() * 5, dur: 6 + Math.random() * 5,
    emoji: emojis[i % emojis.length], size: 14 + Math.random() * 14
  })), [tema.id]);
  return /*#__PURE__*/React.createElement("div", { style: { position: 'absolute', inset: 0, zIndex: 3, pointerEvents: 'none', overflow: 'hidden' } },
  drops.map((d) => /*#__PURE__*/React.createElement("span", { key: d.id, style: { position: 'absolute', left: d.left + '%', top: -30, fontSize: d.size,
      animation: 'fall ' + d.dur + 's linear ' + d.delay + 's infinite' } }, d.emoji)), /*#__PURE__*/
  React.createElement("style", null, '@keyframes fall{0%{transform:translateY(-30px) rotate(0deg);opacity:0;}10%{opacity:1;}100%{transform:translateY(100vh) rotate(360deg);opacity:.85;}}')
  );
}
function ThemeAnimationPreview({ tema, onClose }) {
  const emojis = emojisDeTema(tema);
  const drops = useMemo(() => [...Array(24)].map((_, i) => ({
    id: i, left: Math.random() * 100, delay: Math.random() * 4, dur: 4 + Math.random() * 4,
    emoji: emojis[i % emojis.length] || tema.emoji, size: 16 + Math.random() * 18
  })), [tema.id]);
  return /*#__PURE__*/React.createElement("div", { className: "modal-bg", onClick: onClose }, /*#__PURE__*/
  React.createElement("div", { style: { position: 'relative', width: 'min(560px,92vw)', height: 420, borderRadius: 18, overflow: 'hidden',
      background: tema.fondo, border: '2px solid ' + tema.colorPrimario } }, /*#__PURE__*/
  React.createElement("div", { style: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 2 } }, /*#__PURE__*/
  React.createElement("div", { style: { fontSize: 40 } }, tema.emoji), /*#__PURE__*/
  React.createElement("div", { style: { fontFamily: 'var(--font-display)', fontSize: 30, color: tema.colorPrimario, letterSpacing: 1 } }, tema.nombre), /*#__PURE__*/
  React.createElement("div", { style: { color: tema.texto, fontSize: 12, marginTop: 6 } }, "Vista previa simulada de la animaci\xF3n de temporada"), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-secondary btn-sm", style: { marginTop: 16 }, onClick: onClose }, "Cerrar")
  ),
  drops.map((d) => /*#__PURE__*/React.createElement("span", { key: d.id, style: {
      position: 'absolute', left: d.left + '%', top: -30, fontSize: d.size, zIndex: 1,
      animation: 'fall ' + d.dur + 's linear ' + d.delay + 's infinite'
    } }, d.emoji)), /*#__PURE__*/
  React.createElement("style", null, '@keyframes fall{0%{transform:translateY(-30px) rotate(0deg);opacity:0;}10%{opacity:1;}100%{transform:translateY(440px) rotate(360deg);opacity:.9;}}')
  )
  );
}
function PromoCortesiaPanel() {
  const { state, setState, allProducts, log, toast } = useStore();
  const promo = state.cortesiaPromo || { activa: false, modo: 'mismo', bebidaFijaId: '' };
  const bebidas = allProducts.filter((p) => p.tipo !== 'comida');
  function toggle() {
    const nuevaActiva = !promo.activa;
    setState({ cortesiaPromo: { ...promo, activa: nuevaActiva } });
    log('Administrador', (nuevaActiva ? 'Activó' : 'Desactivó') + ' la promoción de bebida de cortesía');
    toast(nuevaActiva ? '🎁 Promoción de cortesía ACTIVADA — cada bebida vendida generará una cortesía.' : 'Promoción de cortesía desactivada.');
  }
  function cambiarModo(modo) {setState({ cortesiaPromo: { ...promo, modo } });}
  function cambiarBebidaFija(bebidaFijaId) {setState({ cortesiaPromo: { ...promo, bebidaFijaId } });}
  const pendientes = state.cortesias.filter((c) => c.tipo === 'promo_temporada' && !c.entregada).length;
  return /*#__PURE__*/React.createElement("div", { className: "card", style: { marginBottom: 16 } }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow" }, /*#__PURE__*/React.createElement("h3", { style: { margin: 0 } }, "\uD83C\uDF81 Promoci\xF3n de bebida de cortes\xEDa"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/
  React.createElement("button", { className: 'btn btn-sm ' + (promo.activa ? 'btn-secondary' : 'btn-primary'), onClick: toggle }, promo.activa ? 'Desactivar promoción' : 'Activar promoción')
  ), /*#__PURE__*/
  React.createElement("p", { className: "small", style: { marginTop: 8 } }, "Act\xEDvala cuando quieras premiar a los clientes, en cualquier momento \u2014 ", /*#__PURE__*/
  React.createElement("strong", null, "no est\xE1 ligada permanentemente a ninguna temporada"), ". Mientras est\xE9 activa, cada vez que un cliente compre una bebida (desde la p\xE1gina p\xFAblica o registrada por el mesero/cantinero), el sistema genera autom\xE1ticamente una bebida de cortes\xEDa y avisa al Cantinero con el nombre del cliente y qu\xE9 bebida le toca."


  ),
  promo.activa && /*#__PURE__*/React.createElement("span", { className: "tag ok", style: { marginBottom: 10, display: 'inline-block' } }, "\uD83D\uDFE2 Promoci\xF3n activa ahora mismo"), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-2", style: { marginTop: 6 } }, /*#__PURE__*/
  React.createElement(Field, { label: "\xBFQu\xE9 bebida se regala?" }, /*#__PURE__*/
  React.createElement("select", { value: promo.modo, onChange: (e) => cambiarModo(e.target.value) }, /*#__PURE__*/
  React.createElement("option", { value: "mismo" }, "La misma bebida que el cliente compr\xF3"), /*#__PURE__*/
  React.createElement("option", { value: "fija" }, "Una bebida espec\xEDfica definida aqu\xED")
  )
  ),
  promo.modo === 'fija' && /*#__PURE__*/React.createElement(Field, { label: "Bebida de cortes\xEDa fija" }, /*#__PURE__*/
  React.createElement("select", { value: promo.bebidaFijaId, onChange: (e) => cambiarBebidaFija(e.target.value) }, /*#__PURE__*/
  React.createElement("option", { value: "" }, "Selecciona\u2026"),
  bebidas.map((b) => /*#__PURE__*/React.createElement("option", { key: b.id, value: b.id }, b.nombre))
  )
  )
  ),
  pendientes > 0 && /*#__PURE__*/React.createElement("div", { className: "alert", style: { marginTop: 10 } }, "\uD83C\uDF79 Hay ", /*#__PURE__*/React.createElement("strong", null, pendientes), " cortes\xEDa(s) de temporada pendientes de entregar por el Cantinero."), /*#__PURE__*/
  React.createElement("div", { style: { marginTop: 12 } }, /*#__PURE__*/
  React.createElement("h4", { style: { margin: '0 0 6px' } }, "Historial reciente de cortes\xEDas de temporada"), /*#__PURE__*/
  React.createElement(DataTable, { emptyText: "A\xFAn no se ha generado ninguna cortes\xEDa.", columns: [
    { key: 'fecha', label: 'Fecha' }, { key: 'hora', label: 'Hora' }, { key: 'clienteNombre', label: 'Cliente' }, { key: 'bebida', label: 'Bebida' },
    { key: 'entregada', label: 'Estado', render: (r) => /*#__PURE__*/React.createElement("span", { className: 'tag ' + (r.entregada ? 'ok' : 'warn') }, r.entregada ? 'Entregada' : 'Pendiente') }],
    rows: [...state.cortesias].filter((c) => c.tipo === 'promo_temporada').reverse().slice(0, 20) })
  )
  );
}
function AdminTemas() {
  const { state, updateItem, setState, log, toast } = useStore();
  const [previewId, setPreviewId] = useState(null);
  function activarManual(c) {setState({ activeThemeId: state.activeThemeId === c.id ? null : c.id });log('Administrador', (state.activeThemeId === c.id ? 'Desactivó' : 'Activó manualmente') + ' el tema ' + c.nombre);toast(state.activeThemeId === c.id ? 'Tema desactivado' : '🎨 Tema activado: ' + c.nombre);}
  function guardarColores(c, campos) {updateItem('campaigns', c.id, campos);toast('Colores actualizados');}
  const previewTema = state.campaigns.find((c) => c.id === previewId);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Temas y temporadas"), /*#__PURE__*/
  React.createElement(PromoCortesiaPanel, null), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Exclusivo del Administrador: controla la apariencia visual completa de la p\xE1gina p\xFAblica (fondo, botones, tarjetas, textos, colores) \u2014 independiente del modo oscuro/claro. Se puede combinar con activaci\xF3n autom\xE1tica por fecha o forzar manualmente. Usa \"Simular animaci\xF3n\" para ver una vista previa del tema sin necesidad de activarlo."), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-3" },
  state.campaigns.map((c) => /*#__PURE__*/React.createElement("div", { key: c.id, className: "card", style: { background: 'var(--bg-soft)' } }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow" }, /*#__PURE__*/React.createElement("span", { style: { fontSize: 24 } }, c.emoji), /*#__PURE__*/React.createElement("strong", { style: { marginLeft: 8 } }, c.nombre)), /*#__PURE__*/
  React.createElement("div", { className: "small", style: { margin: '6px 0' } }, "Modo: ", c.modo === 'auto' ? 'Automático por fecha (' + c.desde + ' a ' + c.hasta + ')' : 'Manual'), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { gap: 6, marginBottom: 8 } },
  ['colorPrimario', 'colorSecundario', 'fondo', 'tarjetas', 'texto'].map((k) => /*#__PURE__*/React.createElement("input", { key: k, type: "color", value: c[k], title: k, style: { width: 28, height: 28, padding: 0, border: 'none' }, onChange: (e) => guardarColores(c, { [k]: e.target.value }) }))
  ), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { flexWrap: 'wrap' } }, /*#__PURE__*/
  React.createElement("button", { className: 'btn btn-sm ' + (state.activeThemeId === c.id ? 'btn-secondary' : 'btn-primary'), onClick: () => activarManual(c) }, state.activeThemeId === c.id ? 'Desactivar tema (manual)' : 'Activar tema ahora (manual)'), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => setPreviewId(c.id) }, "\uD83C\uDFAC Simular animaci\xF3n")
  ), /*#__PURE__*/
  React.createElement("div", { className: "small", style: { marginTop: 6 } }, "Activa/inactiva para campa\xF1as: ", /*#__PURE__*/React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => updateItem('campaigns', c.id, { activa: !c.activa }) }, c.activa ? 'Marcar inactiva' : 'Marcar activa'))
  ))
  ),
  previewTema && /*#__PURE__*/React.createElement(ThemeAnimationPreview, { tema: previewTema, onClose: () => setPreviewId(null) })
  );
}

/* ============================= PROMOCIÓN DE CUMPLEAÑOS (sección 2) ============================= */
function AdminCumpleanos() {
  const { state, setState, allProducts, log, toast } = useStore();
  const promo = state.cumpleanosPromo || { activa: false, beneficioTipo: 'bebida', bebidaId: '', descuentoPct: 15, nota: '' };
  const bebidas = allProducts.filter((p) => p.tipo !== 'comida');
  const mesActualNombre = MONTHS[new Date().getMonth()];
  function toggle() {
    const nuevaActiva = !promo.activa;
    setState({ cumpleanosPromo: { ...promo, activa: nuevaActiva } });
    log('Administrador', (nuevaActiva ? 'Activó' : 'Desactivó') + ' la promoción de cumpleaños');
    toast(nuevaActiva ? '🎂 Promoción de cumpleaños ACTIVADA para ' + mesActualNombre + '.' : 'Promoción de cumpleaños desactivada.');
  }
  function patch(campos) {setState({ cumpleanosPromo: { ...promo, ...campos } });}
  const clientesDelMes = state.customers.filter((c) => esMesDeCumpleanos(c.cumpleanos));
  const cortesiasCumple = state.cortesias.filter((c) => c.tipo === 'cumpleanos');
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "\uD83C\uDF82 Promoci\xF3n de cumplea\xF1os"), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginBottom: 16 } }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow" }, /*#__PURE__*/React.createElement("h3", { style: { margin: 0 } }, "Estado de la promoci\xF3n"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/
  React.createElement("button", { className: 'btn btn-sm ' + (promo.activa ? 'btn-secondary' : 'btn-primary'), onClick: toggle }, promo.activa ? 'Desactivar' : 'Activar para ' + mesActualNombre)
  ), /*#__PURE__*/
  React.createElement("p", { className: "small", style: { marginTop: 8 } }, "Act\xEDvala manualmente cada mes (normalmente al inicio del mes). Mientras est\xE9 activa, cuando un cliente con cuenta haga un pedido y su fecha de cumplea\xF1os registrada caiga en el ", /*#__PURE__*/

  React.createElement("strong", null, "mes actual (", mesActualNombre, ")"), ", ver\xE1 un mensaje de felicitaci\xF3n y recibir\xE1 autom\xE1ticamente el beneficio que definas abajo. Puedes desactivarla cuando quieras."

  ),
  promo.activa && /*#__PURE__*/React.createElement("span", { className: "tag ok", style: { marginBottom: 10, display: 'inline-block' } }, "\uD83D\uDFE2 Activa este mes (", mesActualNombre, ")"), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-2", style: { marginTop: 6 } }, /*#__PURE__*/
  React.createElement(Field, { label: "Tipo de beneficio" }, /*#__PURE__*/
  React.createElement("select", { value: promo.beneficioTipo, onChange: (e) => patch({ beneficioTipo: e.target.value }) }, /*#__PURE__*/
  React.createElement("option", { value: "bebida" }, "Bebida gratis"), /*#__PURE__*/
  React.createElement("option", { value: "descuento" }, "Descuento (%)"), /*#__PURE__*/
  React.createElement("option", { value: "personalizado" }, "Otro (nota libre)")
  )
  ),
  promo.beneficioTipo === 'bebida' && /*#__PURE__*/React.createElement(Field, { label: "Bebida de regalo" }, /*#__PURE__*/
  React.createElement("select", { value: promo.bebidaId, onChange: (e) => patch({ bebidaId: e.target.value }) }, /*#__PURE__*/
  React.createElement("option", { value: "" }, "La misma bebida que pida el cliente"),
  bebidas.map((b) => /*#__PURE__*/React.createElement("option", { key: b.id, value: b.id }, b.nombre))
  )
  ),
  promo.beneficioTipo === 'descuento' && /*#__PURE__*/React.createElement(Field, { label: "Porcentaje de descuento" }, /*#__PURE__*/
  React.createElement("input", { type: "number", min: "1", max: "100", value: promo.descuentoPct, onChange: (e) => patch({ descuentoPct: Number(e.target.value) || 0 }) })
  ),
  promo.beneficioTipo === 'personalizado' && /*#__PURE__*/React.createElement(Field, { label: "Descripci\xF3n del beneficio (se muestra al cliente)" }, /*#__PURE__*/
  React.createElement("input", { placeholder: "Ej. postre de cortes\xEDa, 2x1 en alitas\u2026", value: promo.nota, onChange: (e) => patch({ nota: e.target.value }) })
  )
  )
  ), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginBottom: 16 } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Clientes que cumplen a\xF1os este mes (", mesActualNombre, ")"), /*#__PURE__*/
  React.createElement(DataTable, { emptyText: "Ning\xFAn cliente registrado tiene su cumplea\xF1os este mes.", columns: [
    { key: 'nombre', label: 'Nombre' }, { key: 'email', label: 'Correo' }, { key: 'cumpleanos', label: 'Fecha de nacimiento', render: (r) => fmtDate(r.cumpleanos) }],
    rows: clientesDelMes })
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Historial de bebidas de regalo por cumplea\xF1os"), /*#__PURE__*/
  React.createElement(DataTable, { emptyText: "A\xFAn no se ha entregado ninguna bebida por cumplea\xF1os.", columns: [
    { key: 'fecha', label: 'Fecha' }, { key: 'clienteNombre', label: 'Cliente' }, { key: 'bebida', label: 'Bebida' },
    { key: 'entregada', label: 'Estado', render: (r) => /*#__PURE__*/React.createElement("span", { className: 'tag ' + (r.entregada ? 'ok' : 'warn') }, r.entregada ? 'Entregada' : 'Pendiente') }],
    rows: [...cortesiasCumple].reverse().slice(0, 20) })
  )
  );
}
/* ============================= HORARIO DE CIERRE POR TEMPORADA (sección 3) ============================= */
// El Admin sube/actualiza la foto del menú físico del negocio; Mesero y Cantinero la consultan en pantalla completa.
function AdminMenuFisico() {
  const { state, setState, log, toast } = useStore();
  function subir(e) {
    const f = e.target.files[0];if (!f) return;
    const url = URL.createObjectURL(f);
    setState({ menuFisico: { url, fecha: new Date().toLocaleString('es-MX') } });
    log('Administrador', 'Actualizó la imagen del menú físico');
    toast('📖 Menú físico actualizado — ya está visible para Mesero y Cantinero');
  }
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Men\xFA f\xEDsico (imagen)"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Sube una foto del men\xFA f\xEDsico del negocio. Se mostrar\xE1 en pantalla completa en la secci\xF3n \"Men\xFA\" del Mesero y del Cantinero, para que puedan consultarla r\xE1pido mientras atienden."), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { maxWidth: 480 } }, /*#__PURE__*/
  React.createElement(Field, { label: "Imagen del men\xFA" }, /*#__PURE__*/React.createElement("input", { type: "file", accept: "image/*", onChange: subir })),
  state.menuFisico?.fecha && /*#__PURE__*/React.createElement("div", { className: "small", style: { marginTop: 6 } }, "\xDAltima actualizaci\xF3n: ", state.menuFisico.fecha)
  ),
  state.menuFisico?.url && /*#__PURE__*/React.createElement("div", { className: "card", style: { marginTop: 14, maxWidth: 480 } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Vista previa"), /*#__PURE__*/
  React.createElement("img", { src: state.menuFisico.url, style: { width: '100%', borderRadius: 10 } })
  )
  );
}
// Vista a pantalla completa del menú físico, para Mesero y Cantinero.
function MenuFisicoViewer() {
  const { state } = useStore();
  const menu = state.menuFisico;
  if (!menu?.url) return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, "Men\xFA"), /*#__PURE__*/React.createElement("p", { className: "small" }, "El administrador a\xFAn no ha subido una imagen del men\xFA f\xEDsico."));
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Men\xFA"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "\xDAltima actualizaci\xF3n: ", menu.fecha), /*#__PURE__*/
  React.createElement("div", { style: { textAlign: 'center' } }, /*#__PURE__*/React.createElement("img", { src: menu.url, style: { maxWidth: '100%', borderRadius: 12, border: '1px solid var(--line)' } }))
  );
}
function AdminHorariosCierre() {
  const { state, setState, notify, log, toast } = useStore();
  const [, setTick] = useState(0);
  useEffect(() => {const t = setInterval(() => setTick((x) => x + 1), 30000);return () => clearInterval(t);}, []);
  const hc = state.horariosCierre || { activo: false, cierreCocina: '23:00', cierreEstablecimiento: '00:15' };
  function toggle() {
    const nuevo = !hc.activo;
    setState({ horariosCierre: { ...hc, activo: nuevo } });
    log('Administrador', (nuevo ? 'Activó' : 'Desactivó') + ' el horario especial de cierre');
    toast(nuevo ? '🕛 Horario especial de cierre ACTIVADO.' : 'Horario especial de cierre desactivado — vuelve al horario normal.');
  }
  function patch(campos) {setState({ horariosCierre: { ...hc, ...campos } });}
  const cocinaCerrada = cocinaCerradaPorHorario(hc);
  const estCerrado = establecimientoCerradoPorHorario(hc);

  // --- Horario diario de la Cocina (Forma 1: automático · Forma 2: manual, aquí desde el panel del Admin) ---
  const cocinaCfg = cocinaHorarioActual(state);
  const infoCocina = cocinaEstadoInfo(state);
  function patchCocina(campos) {setState({ cocinaHorario: { ...cocinaCfg, ...campos } });}
  function forzarCocina(estado) {
    setState({ cocinaManual: { estado, fecha: todayISO(), hora: nowTime(), por: 'Administrador' } });
    log('Administrador', (estado === 'abierta' ? 'Abrió' : 'Cerró') + ' la cocina manualmente');
    notify({ tipo: 'cocina_estado', estado, automatico: false, por: 'Administrador' });
    toast(estado === 'abierta' ? '🟢 Cocina abierta manualmente' : '🔴 Cocina cerrada manualmente');
  }
  function volverAutomatico() {
    setState({ cocinaManual: null });
    log('Administrador', 'Regresó la cocina al horario automático');
    toast('🔄 La cocina vuelve a regirse por el horario automático');
  }

  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "\uD83D\uDD5B Horarios"), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginBottom: 14 } }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow" }, /*#__PURE__*/React.createElement("h3", { style: { margin: 0 } }, "\uD83C\uDF73 Horario de la Cocina (todos los d\xEDas)"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/
  React.createElement("span", { className: 'tag ' + (infoCocina.abierta ? 'ok' : 'danger') }, infoCocina.abierta ? '🟢 Abierta' : '🔴 Cerrada')
  ), /*#__PURE__*/
  React.createElement("p", { className: "small", style: { marginTop: 8 } }, /*#__PURE__*/
  React.createElement("strong", null, "Forma 1 \u2014 Autom\xE1tico:"), " la cocina abre y cierra sola todos los d\xEDas con este horario.", /*#__PURE__*/
  React.createElement("strong", null, " Forma 2 \u2014 Manual:"), " t\xFA o la Cocinera pueden forzar la apertura o el cierre en cualquier momento; el override dura solo por hoy y ma\xF1ana vuelve al horario autom\xE1tico."
  ), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-2", style: { marginTop: 6 } }, /*#__PURE__*/
  React.createElement(Field, { label: "Apertura autom\xE1tica" }, /*#__PURE__*/React.createElement("input", { type: "time", value: cocinaCfg.horaApertura, onChange: (e) => patchCocina({ horaApertura: e.target.value }) })), /*#__PURE__*/
  React.createElement(Field, { label: "Cierre autom\xE1tico" }, /*#__PURE__*/React.createElement("input", { type: "time", value: cocinaCfg.horaCierreAuto, onChange: (e) => patchCocina({ horaCierreAuto: e.target.value }) }))
  ), /*#__PURE__*/
  React.createElement("div", { className: "small", style: { marginTop: 8 } }, "Estado actual desde las ", /*#__PURE__*/
  React.createElement("strong", null, horaTexto12(infoCocina.hora)), " \u2014 ", infoCocina.automatico ? 'automático, según el horario configurado arriba.' : 'manual, forzado por ' + infoCocina.por + '.'
  ), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { marginTop: 12, gap: 8, flexWrap: 'wrap' } }, /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary btn-sm", onClick: () => forzarCocina('abierta'), disabled: infoCocina.abierta && infoCocina.automatico }, "\uD83D\uDFE2 Forzar apertura ahora"), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: () => forzarCocina('cerrada'), disabled: !infoCocina.abierta && infoCocina.automatico }, "\uD83D\uDD34 Forzar cierre ahora"),
  !infoCocina.automatico && /*#__PURE__*/React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: volverAutomatico }, "\uD83D\uDD04 Volver al horario autom\xE1tico")
  )
  ), /*#__PURE__*/
  React.createElement("h1", null, "\uD83D\uDD5B Horario de cierre por temporada"), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow" }, /*#__PURE__*/React.createElement("h3", { style: { margin: 0 } }, "Estado"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/
  React.createElement("button", { className: 'btn btn-sm ' + (hc.activo ? 'btn-secondary' : 'btn-primary'), onClick: toggle }, hc.activo ? 'Desactivar horario especial' : 'Activar horario especial')
  ), /*#__PURE__*/
  React.createElement("p", { className: "small", style: { marginTop: 8 } }, "\xDAsalo solo durante temporadas espec\xEDficas de alta demanda donde necesites limitar el horario \u2014 ", /*#__PURE__*/
  React.createElement("strong", null, "no aplica de forma permanente"), ". Solo el Administrador puede activarlo o desactivarlo. Mientras est\xE9 activo, al llegar la hora de cierre de cocina se bloquean los pedidos de comida, y al llegar la hora de cierre del establecimiento se bloquean todos los pedidos. La Cocinera recibe un aviso 15 minutos antes."


  ), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-2", style: { marginTop: 6 } }, /*#__PURE__*/
  React.createElement(Field, { label: "Cierre de cocina" }, /*#__PURE__*/React.createElement("input", { type: "time", value: hc.cierreCocina, onChange: (e) => patch({ cierreCocina: e.target.value }) })), /*#__PURE__*/
  React.createElement(Field, { label: "Cierre del establecimiento" }, /*#__PURE__*/React.createElement("input", { type: "time", value: hc.cierreEstablecimiento, onChange: (e) => patch({ cierreEstablecimiento: e.target.value }) }))
  ),
  hc.activo && /*#__PURE__*/React.createElement("div", { className: "flexrow", style: { marginTop: 12, gap: 8, flexWrap: 'wrap' } }, /*#__PURE__*/
  React.createElement("span", { className: 'tag ' + (cocinaCerrada ? 'danger' : 'ok') }, "\uD83C\uDF73 Cocina: ", cocinaCerrada ? 'Cerrada' : 'Abierta'), /*#__PURE__*/
  React.createElement("span", { className: 'tag ' + (estCerrado ? 'danger' : 'ok') }, "\uD83C\uDFE0 Establecimiento: ", estCerrado ? 'Cerrado' : 'Abierto')
  ),
  !hc.activo && /*#__PURE__*/React.createElement("div", { className: "alert", style: { marginTop: 12 } }, "\uD83D\uDFE2 El horario especial est\xE1 desactivado \u2014 el negocio opera con su horario normal (Lunes 1:00pm\u20137:50pm \xB7 Martes a Domingo 2:00pm\u201310:50pm).")
  )
  );
}
function AdminVideosClientes() {
  const { state, updateItem, toast } = useStore();
  const rows = [...state.customerVideos].reverse();
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Videos de clientes (moderaci\xF3n autom\xE1tica)"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Cada video se revisa autom\xE1ticamente al subirse: si su descripci\xF3n no menciona el negocio, se da de baja de inmediato y no aparece en la galer\xEDa p\xFAblica."), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-3", style: { marginBottom: 14 } }, /*#__PURE__*/
  React.createElement(KpiCard, { label: "Aprobados", icon: "\u2705", value: state.customerVideos.filter((v) => v.estado === 'aprobado').length }), /*#__PURE__*/
  React.createElement(KpiCard, { label: "Dados de baja", icon: "\uD83D\uDEAB", value: state.customerVideos.filter((v) => v.estado === 'rechazado').length }), /*#__PURE__*/
  React.createElement(KpiCard, { label: "Total recibidos", icon: "\uD83C\uDFA5", value: state.customerVideos.length })
  ),
  rows.length === 0 && /*#__PURE__*/React.createElement("p", { className: "small" }, "Sin videos recibidos."),
  rows.map((v) => /*#__PURE__*/React.createElement("div", { key: v.id, className: "card", style: { marginBottom: 10 } }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow" }, /*#__PURE__*/React.createElement("strong", null, v.nombre), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", { className: 'tag ' + (v.estado === 'aprobado' ? 'ok' : 'danger') }, v.estado === 'aprobado' ? 'Aprobado' : 'Dado de baja automáticamente')), /*#__PURE__*/
  React.createElement("div", { className: "small" }, v.fecha, " ", v.hora, " \u2014 ", v.descripcion),
  v.estado === 'aprobado' && /*#__PURE__*/React.createElement("div", { style: { marginTop: 8 } }, /*#__PURE__*/
  React.createElement("video", { src: v.url, controls: true, style: { maxWidth: 280, borderRadius: 8 } }), /*#__PURE__*/
  React.createElement("div", { style: { marginTop: 6 } }, /*#__PURE__*/React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => {updateItem('customerVideos', v.id, { estado: 'rechazado' });toast('Video retirado de la galería');} }, "Retirar de la galer\xEDa"))
  )
  ))
  );
}

function AdminConectores() {
  const { state, setState, log, toast } = useStore();
  const conectores = [
  { id: 'servidor', nombre: 'Servidor / Backend (Symfony u otro)', icon: '🖥️', desc: 'Reemplazaría el estado en memoria/localStorage por una base de datos real.' },
  { id: 'pagos', nombre: 'Pasarela de pagos', icon: '💳', desc: 'Procesaría transferencias y pagos con tarjeta reales (Stripe, Conekta, etc.).' },
  { id: 'whatsapp', nombre: 'WhatsApp Business', icon: '💬', desc: 'Enviaría notificaciones reales de pedidos y confirmaciones.' },
  { id: 'calendar', nombre: 'Google Calendar', icon: '📅', desc: 'Sincronizaría turnos, eventos y renta del local con un calendario real.' },
  { id: 'correo', nombre: 'Correo (SMTP)', icon: '✉️', desc: 'Enviaría correos reales de recuperación de contraseña y confirmaciones.' },
  { id: 'redes', nombre: 'Redes sociales', icon: '📣', desc: 'Publicaría automáticamente campañas y promociones.' }];

  const estado = state.connectorsStatus || {};
  function toggle(c) {
    const nuevo = !estado[c.id];
    setState((s) => ({ ...s, connectorsStatus: { ...(s.connectorsStatus || {}), [c.id]: nuevo } }));
    log('Administrador', (nuevo ? 'Simuló conexión con ' : 'Desconectó ') + c.nombre);
    toast(nuevo ? '🔌 ' + c.nombre + ' — conexión simulada activa (prototipo, sin servidor real)' : c.nombre + ' desconectado');
  }
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Conectores"), /*#__PURE__*/
  React.createElement("div", { className: "alert", style: { marginBottom: 16 } }, "\u26A0\uFE0F Este prototipo no tiene backend: aqu\xED solo se ", /*#__PURE__*/React.createElement("strong", null, "simula"), " el estado de \"conectado\". Para conectar de verdad, este panel necesitar\xEDa un servidor real (API, base de datos, credenciales, etc.), que est\xE1 fuera del alcance de este prototipo."), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-3" },
  conectores.map((c) => /*#__PURE__*/React.createElement("div", { key: c.id, className: "card", style: { background: 'var(--bg-soft)' } }, /*#__PURE__*/
  React.createElement("div", { style: { fontSize: 24 } }, c.icon), /*#__PURE__*/
  React.createElement("div", { style: { fontWeight: 700, margin: '4px 0' } }, c.nombre), /*#__PURE__*/
  React.createElement("div", { className: "small", style: { marginBottom: 10 } }, c.desc), /*#__PURE__*/
  React.createElement("div", { className: "flexrow" }, /*#__PURE__*/React.createElement("span", { className: 'tag ' + (estado[c.id] ? 'ok' : 'warn') }, estado[c.id] ? '🟢 Conectado (simulado)' : '⚪ Sin conectar')), /*#__PURE__*/
  React.createElement("button", { className: 'btn btn-sm ' + (estado[c.id] ? 'btn-secondary' : 'btn-primary'), style: { marginTop: 8 }, onClick: () => toggle(c) }, estado[c.id] ? 'Desconectar' : 'Conectar (simulado)')
  ))
  )
  );
}

function AdminCarrusel() {
  const { state, setState, pushTo, updateItem, toast, log } = useStore();
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Carrusel / Campa\xF1as"), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginBottom: 14 } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Campa\xF1as por fecha especial (exclusivo de Administrador)"), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-3" },
  state.campaigns.map((c) => /*#__PURE__*/React.createElement("div", { key: c.id, className: "card", style: { background: 'var(--bg-soft)' } }, /*#__PURE__*/
  React.createElement("div", { style: { fontSize: 26 } }, c.emoji), /*#__PURE__*/
  React.createElement("div", { style: { fontWeight: 700 } }, c.nombre), /*#__PURE__*/
  React.createElement("button", { className: 'btn btn-sm ' + (c.activa ? 'btn-secondary' : 'btn-primary'), style: { marginTop: 8 }, onClick: () => {updateItem('campaigns', c.id, { activa: !c.activa });log('Administrador', (c.activa ? 'Desactivó' : 'Activó') + ' campaña ' + c.nombre);} }, c.activa ? 'Desactivar' : 'Activar')
  ))
  )
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Subir video promocional / preparaci\xF3n / instalaciones"), /*#__PURE__*/
  React.createElement(VideoUploader, null), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "La carga de im\xE1genes de producto para el carrusel principal la gestiona el rol Cantinero/Bartender (ver su panel).")
  )
  );
}
function VideoUploader() {
  const [videos, setVideos] = useState([]);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("input", { type: "file", accept: "video/*", onChange: (e) => {
      const f = e.target.files[0];if (!f) return;
      setVideos((v) => [...v, { id: uid('vid'), name: f.name, url: URL.createObjectURL(f) }]);
    } }), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-3", style: { marginTop: 10 } },
  videos.map((v) => /*#__PURE__*/React.createElement("div", { key: v.id, className: "card" }, /*#__PURE__*/React.createElement("video", { src: v.url, controls: true, style: { width: '100%', borderRadius: 8 } }), /*#__PURE__*/React.createElement("div", { className: "small" }, v.name)))
  )
  );
}

function AdminCupones() {
  const { state, setState, toast } = useStore();
  const cupon = cuponDelMes();
  const [email, setEmail] = useState('');
  function agregar() {
    if (!email.trim()) {toast('Escribe el correo/usuario de la cuenta');return;}
    const clave = email.trim().toLowerCase();
    if (state.familiares.includes(clave)) {toast('Ya está en la lista');return;}
    setState((s) => ({ ...s, familiares: [...s.familiares, clave] }));
    setEmail('');
    toast('✅ Agregado al cupón familiar');
  }
  function quitar(f) {setState((s) => ({ ...s, familiares: s.familiares.filter((x) => x !== f) }));toast('Eliminado del cupón familiar');}

  // Uso del cupón este mes calendario: ventas con descuento aplicado, de clientes familiares.
  const mesActual = todayISO().slice(0, 7); // YYYY-MM
  const ventasConCupon = state.sales.filter((s) => s.descuento > 0 && s.fecha.slice(0, 7) === mesActual && state.familiares.includes((s.clienteEmail || '').toLowerCase()));
  const usoPorCliente = {};
  ventasConCupon.forEach((s) => {
    const key = s.clienteEmail;
    if (!usoPorCliente[key]) usoPorCliente[key] = { clienteEmail: key, clienteNombre: s.clienteNombre || key, veces: 0, totalDescontado: 0 };
    usoPorCliente[key].veces++;
    usoPorCliente[key].totalDescontado += s.descuento;
  });
  const filasUso = state.familiares.map((f) => {
    const cli = state.customers.find((c) => c.email.toLowerCase() === f);
    const uso = usoPorCliente[cli?.email] || { veces: 0, totalDescontado: 0 };
    return { id: f, clienteNombre: cli ? cli.nombre : f, veces: uso.veces, totalDescontado: uso.totalDescontado };
  });

  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Cup\xF3n familiar"), /*#__PURE__*/
  React.createElement("div", { className: "alert", style: { marginBottom: 14 } }, "\uD83D\uDD12 Este cup\xF3n NO es p\xFAblico \u2014 solo las cuentas de la lista de abajo lo ven y lo pueden usar en su checkout. Cualquier otro cliente no ve nada relacionado al cup\xF3n."), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginBottom: 14 } }, /*#__PURE__*/
  React.createElement("div", { className: "small" }, "C\xF3digo generado autom\xE1ticamente este mes (10% de descuento en cualquier producto):"), /*#__PURE__*/
  React.createElement("div", { style: { fontSize: 30, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--neon-2)' } }, cupon), /*#__PURE__*/
  React.createElement("div", { className: "small" }, "Expira al cambiar de mes calendario (calculado con JS, no capturado manualmente) y se genera uno nuevo autom\xE1ticamente.")
  ), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginBottom: 14 } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Cuentas con acceso al cup\xF3n familiar"), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { marginBottom: 10 } }, /*#__PURE__*/
  React.createElement("input", { placeholder: "Correo/usuario de la cuenta de cliente", value: email, onChange: (e) => setEmail(e.target.value) }), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", onClick: agregar }, "Agregar")
  ),
  state.familiares.length === 0 && /*#__PURE__*/React.createElement("p", { className: "small" }, "Sin cuentas familiares registradas."),
  state.familiares.map((f) => {
    const cli = state.customers.find((c) => c.email.toLowerCase() === f);
    return /*#__PURE__*/React.createElement("div", { key: f, className: "flexrow", style: { marginBottom: 6 } }, /*#__PURE__*/
    React.createElement("span", { className: "chip" }, cli ? cli.nombre + ' — ' : '', f), /*#__PURE__*/
    React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => quitar(f) }, "Quitar")
    );
  })
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Uso del cup\xF3n este mes"), /*#__PURE__*/
  React.createElement(DataTable, { emptyText: "Sin uso registrado este mes.", columns: [
    { key: 'clienteNombre', label: 'Cliente' }, { key: 'veces', label: 'Veces usado este mes' },
    { key: 'totalDescontado', label: 'Total descontado', render: (r) => money(r.totalDescontado) }],
    rows: filasUso })
  )
  );
}

function AdminHistorialCampanas() {
  const { state } = useStore();
  const rows = state.campaigns.map((c) => {
    const ventasAsociadas = state.sales.length ? Math.round(state.sales.length * Math.random() * 0.3) : 0;
    return { id: c.id, nombre: c.nombre, estado: c.activa ? 'Activa' : 'Inactiva', ventas: c.activa ? ventasAsociadas : 0 };
  });
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, "Historial de campa\xF1as y m\xE9tricas"), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/React.createElement(DataTable, { columns: [{ key: 'nombre', label: 'Campaña' }, { key: 'estado', label: 'Estado' }, { key: 'ventas', label: 'Ventas asociadas (mock)' }], rows: rows }))
  );
}

// Saldo del fondo de caja del bartender para una fecha dada: lo asignado ese día menos lo gastado desde el fondo ese día.
function fondoCajaDelDia(state, fecha) {
  const asignado = state.cashFunds.filter((f) => f.fecha === fecha).reduce((a, f) => a + f.monto, 0);
  const gastado = state.expenses.filter((e) => e.fecha === fecha && e.origen === 'fondo_caja').reduce((a, e) => a + e.monto, 0);
  return { asignado, gastado, saldo: asignado - gastado };
}
function AdminFondoCaja() {
  const { state, pushTo, log, toast } = useStore();
  const [monto, setMonto] = useState('');
  const [nota, setNota] = useState('');
  const bartender = state.staff.find((s) => s.rol === 'bartender');
  const hoy = todayISO();
  const { asignado, gastado, saldo } = fondoCajaDelDia(state, hoy);

  function entregar(m) {
    if (!m || m <= 0) {toast('Ingresa un monto válido');return;}
    pushTo('cashFunds', { id: uid('cf'), monto: Number(m), fecha: hoy, hora: nowTime(), nota, entregadoPor: 'Administrador' });
    log('Administrador', 'Entregó fondo de caja de ' + money(m) + ' a ' + (bartender ? bartender.nombre : 'Bartender'));
    toast('🏦 Fondo de caja de ' + money(m) + ' entregado a ' + (bartender ? bartender.nombre : 'Bartender'));
    setMonto('');setNota('');
  }

  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Fondo de caja (Bartender)"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "El administrador deja aqu\xED una cantidad al bartender \u2014como segundo al mando\u2014 para abrir la caja y operar la barra durante el turno. Los gastos que se tomen de este fondo (secci\xF3n \"Gastos\" con origen \"Fondo de caja\") se descuentan autom\xE1ticamente."), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-3", style: { marginBottom: 16 } }, /*#__PURE__*/
  React.createElement(KpiCard, { label: "Asignado hoy", icon: "\uD83C\uDFE6", value: money(asignado) }), /*#__PURE__*/
  React.createElement(KpiCard, { label: "Gastado del fondo hoy", icon: "\uD83D\uDCB8", value: money(gastado) }), /*#__PURE__*/
  React.createElement(KpiCard, { label: "Saldo disponible hoy", icon: "\uD83D\uDCB0", value: money(saldo) })
  ), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginBottom: 14, maxWidth: 520 } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Entregar fondo de caja"), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { marginBottom: 10 } },
  [500, 1000, 2000].map((m) => /*#__PURE__*/React.createElement("button", { key: m, className: "btn btn-secondary btn-sm", onClick: () => entregar(m) }, money(m)))
  ), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-2" }, /*#__PURE__*/
  React.createElement(Field, { label: "Cantidad personalizada" }, /*#__PURE__*/React.createElement("input", { type: "number", value: monto, onChange: (e) => setMonto(e.target.value) })), /*#__PURE__*/
  React.createElement(Field, { label: "Nota (opcional)" }, /*#__PURE__*/React.createElement("input", { placeholder: "Ej. Fondo del turno de hoy", value: nota, onChange: (e) => setNota(e.target.value) }))
  ), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", style: { marginTop: 10 }, onClick: () => entregar(Number(monto)) }, "Entregar cantidad personalizada")
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Historial de entregas"), /*#__PURE__*/
  React.createElement(DataTable, { emptyText: "A\xFAn no se ha entregado ning\xFAn fondo.", columns: [{ key: 'fecha', label: 'Fecha' }, { key: 'hora', label: 'Hora' }, { key: 'monto', label: 'Monto', render: (r) => money(r.monto) }, { key: 'nota', label: 'Nota', render: (r) => r.nota || '—' }], rows: [...state.cashFunds].reverse() })
  )
  );
}

function AdminGastos() {
  const { state, pushTo, toast } = useStore();
  const [categoria, setCategoria] = useState('Cantinero');const [concepto, setConcepto] = useState('');const [monto, setMonto] = useState('');
  const [origen, setOrigen] = useState('otro'); // 'fondo_caja' | 'otro'
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Gastos"), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginBottom: 14 } }, /*#__PURE__*/
  React.createElement("div", { className: "grid grid-4" }, /*#__PURE__*/
  React.createElement(Field, { label: "Categor\xEDa" }, /*#__PURE__*/React.createElement("select", { value: categoria, onChange: (e) => setCategoria(e.target.value) }, EXPENSE_CATEGORIES.map((c) => /*#__PURE__*/React.createElement("option", { key: c }, c)))), /*#__PURE__*/
  React.createElement(Field, { label: "Concepto" }, /*#__PURE__*/React.createElement("input", { value: concepto, onChange: (e) => setConcepto(e.target.value) })), /*#__PURE__*/
  React.createElement(Field, { label: "Monto" }, /*#__PURE__*/React.createElement("input", { type: "number", value: monto, onChange: (e) => setMonto(e.target.value) })), /*#__PURE__*/
  React.createElement(Field, { label: "\xBFDe d\xF3nde sale el dinero?" }, /*#__PURE__*/React.createElement("select", { value: origen, onChange: (e) => setOrigen(e.target.value) }, /*#__PURE__*/
  React.createElement("option", { value: "otro" }, "Caja general / Banco"), /*#__PURE__*/
  React.createElement("option", { value: "fondo_caja" }, "Fondo de caja del bartender")
  ))
  ), /*#__PURE__*/
  React.createElement("div", { style: { marginTop: 10 } }, /*#__PURE__*/React.createElement("button", { className: "btn btn-primary", onClick: () => {if (!concepto || !monto) return;pushTo('expenses', { id: uid('exp'), categoria, concepto, monto: Number(monto), fecha: todayISO(), hora: nowTime(), origen });setConcepto('');setMonto('');toast(origen === 'fondo_caja' ? '💸 Gasto registrado — se descontó del fondo de caja del bartender' : 'Gasto registrado');} }, "Registrar"))
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/React.createElement(DataTable, { columns: [
    { key: 'fecha', label: 'Fecha' }, { key: 'categoria', label: 'Categoría' }, { key: 'concepto', label: 'Concepto' },
    { key: 'origen', label: 'Origen', render: (r) => /*#__PURE__*/React.createElement("span", { className: 'tag ' + (r.origen === 'fondo_caja' ? 'warn' : 'ok') }, r.origen === 'fondo_caja' ? '🏦 Fondo de caja' : 'Caja general/Banco') },
    { key: 'monto', label: 'Monto', render: (r) => money(r.monto) }],
    rows: [...state.expenses].reverse() }))
  );
}

function AdminGanancia() {
  const { state } = useStore();
  const [range, setRange] = useState('mes');
  const ventas = state.sales.filter((s) => inRange(s.fecha, range)).reduce((a, s) => a + s.total, 0);
  const gastosPorCat = {};
  state.expenses.filter((g) => inRange(g.fecha, range)).forEach((g) => gastosPorCat[g.categoria] = (gastosPorCat[g.categoria] || 0) + Number(g.monto));
  const totalGastos = Object.values(gastosPorCat).reduce((a, b) => a + b, 0);
  const pagosProv = state.supplierPayments.filter((p) => inRange(p.fecha, range)).reduce((a, p) => a + Number(p.monto), 0);
  const ganancia = ventas - totalGastos - pagosProv;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Ganancia neta"), /*#__PURE__*/
  React.createElement("div", { className: "range-pills", style: { marginBottom: 14 } }, ['hoy', 'semana', 'mes'].map((r) => /*#__PURE__*/React.createElement("button", { key: r, className: 'pill ' + (range === r ? 'active' : ''), onClick: () => setRange(r) }, r))), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-4", style: { marginBottom: 16 } }, /*#__PURE__*/
  React.createElement(KpiCard, { label: "Ventas totales", icon: "\uD83D\uDCB0", value: money(ventas) }), /*#__PURE__*/
  React.createElement(KpiCard, { label: "Gastos operativos", icon: "\uD83D\uDCB8", value: money(totalGastos) }), /*#__PURE__*/
  React.createElement(KpiCard, { label: "Pagos a proveedores", icon: "\uD83D\uDE9A", value: money(pagosProv) }), /*#__PURE__*/
  React.createElement(KpiCard, { label: "Ganancia neta", icon: "\uD83D\uDCC8", value: money(ganancia) })
  ), /*#__PURE__*/
  React.createElement(ChartCard, { title: "Desglose de gastos" }, /*#__PURE__*/React.createElement(BarChart, { data: EXPENSE_CATEGORIES.map((c) => ({ label: c, value: gastosPorCat[c] || 0 })), color: "var(--danger)" })), /*#__PURE__*/
  React.createElement("p", { className: "small", style: { marginTop: 10 } }, "Ganancia = Ventas totales \u2212 (Gastos cantinero + Gastos cocina + Pagos administrativos/servicios/personal + Pagos a proveedores). Calculado autom\xE1ticamente sobre los datos mock.")
  );
}

function AdminPagosProveedores() {
  const { state, pushTo, toast } = useStore();
  const [prov, setProv] = useState('');const [monto, setMonto] = useState('');const [concepto, setConcepto] = useState('');
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, "Pagos a proveedores"), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginBottom: 14 } }, /*#__PURE__*/
  React.createElement("div", { className: "grid grid-4" }, /*#__PURE__*/
  React.createElement(Field, { label: "Proveedor" }, /*#__PURE__*/React.createElement("select", { value: prov, onChange: (e) => setProv(e.target.value) }, /*#__PURE__*/React.createElement("option", { value: "" }, "Selecciona\u2026"), state.suppliers.map((s) => /*#__PURE__*/React.createElement("option", { key: s.id }, s.nombre)))), /*#__PURE__*/
  React.createElement(Field, { label: "Concepto" }, /*#__PURE__*/React.createElement("input", { value: concepto, onChange: (e) => setConcepto(e.target.value) })), /*#__PURE__*/
  React.createElement(Field, { label: "Monto" }, /*#__PURE__*/React.createElement("input", { type: "number", value: monto, onChange: (e) => setMonto(e.target.value) })), /*#__PURE__*/
  React.createElement("div", { style: { alignSelf: 'flex-end' } }, /*#__PURE__*/React.createElement("button", { className: "btn btn-primary", onClick: () => {if (!prov || !monto) return;pushTo('supplierPayments', { id: uid('pay'), proveedor: prov, concepto, monto: Number(monto), fecha: todayISO() });setProv('');setConcepto('');setMonto('');toast('Pago registrado');} }, "Registrar"))
  )
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/React.createElement(DataTable, { columns: [{ key: 'fecha', label: 'Fecha' }, { key: 'proveedor', label: 'Proveedor' }, { key: 'concepto', label: 'Concepto' }, { key: 'monto', label: 'Monto', render: (r) => money(r.monto) }], rows: [...state.supplierPayments].reverse() }))
  );
}

function AdminCorteCaja() {
  const { state } = useStore();
  const hoy = todayISO();
  const { asignado, gastado, saldo } = fondoCajaDelDia(state, hoy);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Corte de caja (supervisi\xF3n)"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "El corte de caja del d\xEDa lo realiza el Bartender (segundo al mando) desde su propio panel, tomando como base el fondo que le dejaste; aqu\xED abajo se ve el resultado de sus cortes para que lo supervises. Cada vez que el bartender cierra un corte, se genera autom\xE1ticamente un archivo Excel descargable con el desglose completo \u2014 tambi\xE9n puedes volver a descargarlo desde aqu\xED en cualquier momento."), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-3", style: { marginBottom: 14 } }, /*#__PURE__*/
  React.createElement(KpiCard, { label: "Fondo asignado hoy", icon: "\uD83C\uDFE6", value: money(asignado) }), /*#__PURE__*/
  React.createElement(KpiCard, { label: "Gastado del fondo hoy", icon: "\uD83D\uDCB8", value: money(gastado) }), /*#__PURE__*/
  React.createElement(KpiCard, { label: "Saldo disponible hoy", icon: "\uD83D\uDCB0", value: money(saldo) })
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Historial de cortes del bartender"), /*#__PURE__*/
  React.createElement(DataTable, { emptyText: "El bartender a\xFAn no ha registrado ning\xFAn corte de caja.", columns: [
    { key: 'fecha', label: 'Fecha' }, { key: 'fondoInicial', label: 'Fondo', render: (r) => money(r.fondoInicial) },
    { key: 'ventasEfectivo', label: 'Ventas efvo.', render: (r) => money(r.ventasEfectivo) },
    { key: 'gastoDelFondo', label: 'Gastos fondo', render: (r) => money(r.gastoDelFondo) },
    { key: 'descuentosCuponHoy', label: 'Cupón familiar', render: (r) => money(r.descuentosCuponHoy || 0) },
    { key: 'efectivoEsperado', label: 'Esperado', render: (r) => money(r.efectivoEsperado) },
    { key: 'efectivoContado', label: 'Contado', render: (r) => money(r.efectivoContado) },
    { key: 'diferencia', label: 'Diferencia', render: (r) => /*#__PURE__*/React.createElement("span", { className: 'tag ' + (r.diferencia === 0 ? 'ok' : 'danger') }, money(r.diferencia)) },
    { key: 'excel', label: 'Excel', render: (r) => /*#__PURE__*/React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => generarExcelCorteCaja(r) }, "\uD83D\uDCE5 Descargar") }],
    rows: [...state.cashCuts].reverse() })
  )
  );
}

function AdminReportes() {
  const { state, setState, toast } = useStore();
  function exportCSV(name, rows) {download(name + '.csv', toCSV(rows));toast('CSV exportado: ' + name);}
  function exportJSON() {download('elrey_backup_' + todayISO() + '.json', JSON.stringify(state, null, 2));setState({ lastExport: new Date().toISOString() });toast('📦 Estado completo exportado como JSON');}
  function restore(e) {
    const file = e.target.files[0];if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {try {const data = JSON.parse(reader.result);setState(data);toast('♻️ Estado restaurado desde archivo');} catch (err) {toast('Archivo inválido');}};
    reader.readAsText(file);
  }
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Reportes y datos del sistema"), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-3" }, /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Exportar datos (CSV)"), /*#__PURE__*/
  React.createElement("div", { className: "grid", style: { gap: 8 } }, /*#__PURE__*/
  React.createElement("button", { className: "btn btn-secondary", onClick: () => exportCSV('ventas', state.sales) }, "Ventas (CSV)"), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-secondary", onClick: () => exportCSV('inventario', state.insumos) }, "Inventario (CSV)"), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-secondary", onClick: () => exportCSV('pedidos_domicilio', state.sales.filter((s) => s.entrega === 'domicilio')) }, "Pedidos a domicilio (CSV)"), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-secondary", onClick: () => exportCSV('clientes', state.familiares) }, "Clientes (CSV)"), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", onClick: exportJSON }, "Exportar JSON completo")
  )
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Datos del sistema"), /*#__PURE__*/
  React.createElement("div", { className: "small", style: { marginBottom: 10 } }, "Datos cargados en memoria \u2714 \xB7 \xDAltimo export: ", state.lastExport ? new Date(state.lastExport).toLocaleString('es-MX') : 'nunca'), /*#__PURE__*/
  React.createElement("div", { className: "grid", style: { gap: 8 } }, /*#__PURE__*/
  React.createElement("button", { className: "btn btn-secondary", onClick: exportJSON }, "Exportar estado completo"), /*#__PURE__*/
  React.createElement("label", { className: "btn btn-secondary", style: { textAlign: 'center' } }, "Restaurar desde archivo", /*#__PURE__*/React.createElement("input", { type: "file", accept: "application/json", style: { display: 'none' }, onChange: restore })), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-secondary", onClick: () => window.print() }, "Imprimir reporte"), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-ghost", style: { borderColor: 'var(--danger)', color: 'var(--danger)' }, onClick: () => {if (confirm('Esto borra todos los datos guardados en este navegador (localStorage) y recarga el prototipo con el catálogo y datos de fábrica más recientes. ¿Continuar?')) {localStorage.removeItem('elrey_proto_state_v1');window.location.reload();}} }, "\uD83D\uDD04 Reiniciar datos de f\xE1brica")
  ), /*#__PURE__*/
  React.createElement("p", { className: "small", style: { marginTop: 8 } }, "Usa \"Reiniciar datos de f\xE1brica\" si actualizaste el prototipo (nuevo cat\xE1logo, nuevas funciones) y no ves los cambios \u2014 es porque tu navegador sigue cargando el estado viejo guardado en localStorage."), /*#__PURE__*/
  React.createElement("div", { className: "small", style: { marginTop: 10 } }, "Badge simulado: \"\xDAltimo respaldo: hace 3 d\xEDas\"")
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Estado de los datos"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "No hay servidor de base de datos al que conectarse: todo el estado vive en memoria del navegador y se sincroniza opcionalmente con localStorage."), /*#__PURE__*/
  React.createElement("div", { className: "tag ok" }, "\u2714 Datos cargados en memoria")
  )
  )
  );
}

function AdminDestacados() {
  const { state } = useStore();
  const nombresMeseros = new Set(state.staff.filter((s) => s.rol === 'mesero').map((s) => s.nombre));
  const mesVentas = state.sales.filter((s) => inRange(s.fecha, 'mes') && nombresMeseros.has(s.mesero));
  const map = {};
  mesVentas.forEach((s) => {if (!map[s.mesero]) map[s.mesero] = { pedidos: 0, total: 0 };map[s.mesero].pedidos++;map[s.mesero].total += s.total;});
  const rows = Object.entries(map).sort((a, b) => b[1].total - a[1].total).map(([mesero, d]) => ({ id: mesero, mesero, pedidos: d.pedidos, total: money(d.total) }));
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, "Meseros destacados (mes en curso)"), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/React.createElement(DataTable, { columns: [{ key: 'mesero', label: 'Mesero' }, { key: 'pedidos', label: 'Pedidos' }, { key: 'total', label: 'Total ($)' }], rows: rows, emptyText: "Sin ventas registradas este mes" }))
  );
}

function AdminBitacora() {
  const { state } = useStore();
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, "Bit\xE1cora de auditor\xEDa"), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/React.createElement(DataTable, { columns: [{ key: 'fecha', label: 'Fecha' }, { key: 'hora', label: 'Hora' }, { key: 'quien', label: 'Quién' }, { key: 'accion', label: 'Acción' }], rows: [...state.auditLog].reverse(), emptyText: "Sin cambios registrados en esta sesi\xF3n" }))
  );
}

function AdminCuenta() {
  const { state, updateItem, toast } = useStore();
  const persona = state.staff.find((s) => s.id === state.staffSession) || state.staff.find((s) => s.rol === 'admin') || {};
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, "Mi cuenta"), /*#__PURE__*/
  React.createElement(PerfilCard, { persona: persona, onGuardar: (patch) => {updateItem('staff', persona.id, patch);toast('✅ Perfil actualizado');} }), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { maxWidth: 420, marginTop: 14 } }, /*#__PURE__*/
  React.createElement(ThemeToggle, null), /*#__PURE__*/
  React.createElement("hr", { className: "line" }), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "M\xF3dulo de ", /*#__PURE__*/React.createElement("strong", null, "Suscripciones"), ": pr\xF3ximamente."), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "M\xF3dulo de ", /*#__PURE__*/React.createElement("strong", null, "Facturaci\xF3n electr\xF3nica"), ": fuera de alcance de este prototipo."), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-secondary", onClick: () => toast('📣 Publicado en redes (simulado) ✅') }, "Publicar en redes")
  )
  );
}

/* ============================= BARTENDER ============================= */
const BAR_SECTIONS = [
{ label: 'Principal', items: [{ key: 'dashboard', label: 'Menú Principal', icon: '📊' }, { key: 'preparacion', label: 'Pedidos en preparación', icon: '🍸' }, { key: 'cuentasabiertas', label: 'Cuentas abiertas', icon: '🧾' }, { key: 'cubetazos', label: 'Cubetazos', icon: '🪣' }, { key: 'rellenos', label: 'Rellenos pendientes', icon: '♻️' }, { key: 'mesas', label: 'Mesas y sanciones', icon: '🪑' }, { key: 'menufisico', label: 'Menú', icon: '📷' }] },
{ label: 'Inventario', items: [{ key: 'catalogo', label: 'Productos / Disponibilidad', icon: '📦' }, { key: 'sabores', label: 'Control de sabores', icon: '🍧' }, { key: 'insumos', label: 'Insumos de barra', icon: '🧊' }, { key: 'faltante', label: 'Reportar faltante', icon: '📣' }, { key: 'cierreturno', label: 'Cierre de turno', icon: '📋' }] },
{ label: 'Contenido', items: [{ key: 'imagenes', label: 'Subir imágenes de producto', icon: '📷' }] },
{ label: 'Evaluación', items: [{ key: 'evaluar', label: 'Evaluación de cierre', icon: '⭐' }] },
{ label: 'Propinas', items: [{ key: 'propinas', label: 'Propinas y reparto', icon: '💵' }] },
{ label: 'Finanzas (segundo al mando)', items: [
  { key: 'fondocajabar', label: 'Fondo de caja', icon: '🏦' },
  { key: 'registrarventa', label: 'Registrar venta', icon: '🧾' },
  { key: 'cortecaja', label: 'Corte de caja', icon: '🧮' },
  { key: 'reportesmeseros', label: 'Reportes de venta (meseros)', icon: '📄' }]
},
{ label: 'Cuenta', items: [{ key: 'cuenta', label: 'Mi perfil', icon: '⚙️' }] }];

function BartenderView() {
  const [section, setSection] = useState('dashboard');
  const { state } = useStore();
  const insumosAlerta = state.insumos.filter((i) => i.area === 'cantinero' && i.stock < i.minimo).length;
  const cuentasAbiertasBadge = (state.cuentasAbiertas || []).filter((t) => t.estado === 'solicitando_pago').length;
  const MAP = {
    dashboard: /*#__PURE__*/React.createElement(BarDashboard, { goto: setSection }), preparacion: /*#__PURE__*/React.createElement(BarPreparacion, null), cuentasabiertas: /*#__PURE__*/React.createElement(CuentasAbiertasPanel, null), cubetazos: /*#__PURE__*/React.createElement(BarCubetazos, null), rellenos: /*#__PURE__*/React.createElement(BarRellenos, null), mesas: /*#__PURE__*/React.createElement(BarMesasSanciones, null), menufisico: /*#__PURE__*/React.createElement(MenuFisicoViewer, null),
    insumos: /*#__PURE__*/React.createElement(InsumosPanel, { area: "cantinero" }), faltante: /*#__PURE__*/React.createElement(ReportarFaltante, { rol: "Cantinero" }), catalogo: /*#__PURE__*/React.createElement(BarInventario, null), cierreturno: /*#__PURE__*/React.createElement(BarCierreTurno, null),
    sabores: /*#__PURE__*/React.createElement(ControlDeSabores, { rol: "Cantinero", categoriasSabores: ['micheladas'], categoriasProductos: ['preparadas'] }),
    imagenes: /*#__PURE__*/React.createElement(ImagenesProducto, null), evaluar: /*#__PURE__*/React.createElement(AdminEvaluaciones, null), propinas: /*#__PURE__*/React.createElement(BarPropinas, null),
    fondocajabar: /*#__PURE__*/React.createElement(BarFondoCaja, null), registrarventa: /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, "Registrar venta"), /*#__PURE__*/React.createElement("p", { className: "small" }, "Registra aqu\xED cualquier venta del turno: la tuya, la de los meseros, bebidas, comida o lo que se haya vendido."), /*#__PURE__*/React.createElement("div", { className: "card" }, /*#__PURE__*/React.createElement(VentaForm, null))),
    cortecaja: /*#__PURE__*/React.createElement(BarCorteCaja, null), cuenta: /*#__PURE__*/React.createElement(CuentaGenerica, { rol: "bartender" }),
    reportesmeseros: /*#__PURE__*/React.createElement(ReporteVentasView, { permitirElegirMesero: true })
  };
  return /*#__PURE__*/React.createElement(PanelLayout, { sections: BAR_SECTIONS, section: section, setSection: setSection, badges: { insumos: insumosAlerta, cuentasabiertas: cuentasAbiertasBadge } }, MAP[section]);
}
// Control de sabores: el Cantinero (o la Cocinera) marca un sabor específico como agotado (ej. Micheladas o
// Alitas), o una bebida preparada completa (ej. Piña colada). Se bloquea al instante en el menú del cliente
// (🚫, no seleccionable), se notifica al administrador automáticamente, se ve en el panel del mesero, y quien
// lo marcó puede restablecerlo. `categoriasSabores` limita qué categorías de sabores se muestran (null = todas).
// `categoriasProductos` agrega categorías cuyos productos completos (sin sabores) se pueden marcar agotados.
function ControlDeSabores({ rol = 'Cantinero', categoriasSabores = null, categoriasProductos = [] }) {
  const { state, setState, notify, log, toast } = useStore();
  const todasConSabor = state.catalog.filter((c) => c.sabores && c.sabores.length > 0);
  const categoriasConSabor = categoriasSabores ? todasConSabor.filter((c) => categoriasSabores.includes(c.id)) : todasConSabor;
  const categoriasDeProductos = state.catalog.filter((c) => categoriasProductos.includes(c.id));

  function toggleSaborAgotado(cat, sabor) {
    const clave = claveSabor(cat.id, sabor);
    const agotado = (state.saboresAgotados || []).includes(clave);
    setState((s) => ({ ...s, saboresAgotados: agotado ? s.saboresAgotados.filter((k) => k !== clave) : [...(s.saboresAgotados || []), clave] }));
    log(rol, (agotado ? 'Repuso sabor: ' : 'Marcó sabor agotado: ') + sabor + ' (' + cat.nombre + ')');
    if (!agotado) {
      notify({ tipo: 'sabor_agotado', categoria: cat.nombre, sabor, reportadoPor: rol, atendido: false });
      toast('🔴 Sabor ' + sabor + ' (' + cat.nombre + ') marcado como agotado — bloqueado para el cliente y notificado al administrador');
    } else {
      toast('🟢 Sabor ' + sabor + ' (' + cat.nombre + ') repuesto — disponible de nuevo para el cliente');
    }
  }
  function toggleProductoAgotado(cat, prod) {
    const nuevoEstado = !prod.agotado;
    setState((s) => ({ ...s, catalog: s.catalog.map((c) => c.id !== cat.id ? c : { ...c, productos: c.productos.map((p) => p.id !== prod.id ? p : { ...p, agotado: nuevoEstado }) }) }));
    log(rol, (nuevoEstado ? 'Marcó agotado: ' : 'Repuso: ') + prod.nombre);
    notify({ tipo: nuevoEstado ? 'stock_agotado' : 'stock_repuesto', producto: prod.nombre, atendido: false });
    toast(nuevoEstado ? '🔴 ' + prod.nombre + ' marcado como agotado — bloqueado para el cliente y notificado al administrador' : '🟢 ' + prod.nombre + ' repuesto — disponible de nuevo');
  }

  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Control de sabores"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Marca un sabor como agotado cuando se termine \u2014 se bloquea al instante en el men\xFA del cliente (aparece con \uD83D\uDEAB y no se puede seleccionar) y se avisa autom\xE1ticamente al administrador. Restabl\xE9celo en cuanto tengas reposici\xF3n."),
  categoriasConSabor.map((cat) => /*#__PURE__*/React.createElement("div", { key: cat.id, className: "card", style: { marginBottom: 14 } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, cat.nombre), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { flexWrap: 'wrap', gap: 10 } },
  cat.sabores.map((sabor) => {
    const agotado = saborEstaAgotado(state, cat.id, sabor);
    return /*#__PURE__*/React.createElement("button", { key: sabor, className: 'btn btn-sm ' + (agotado ? 'btn-primary' : 'btn-secondary'), style: agotado ? { background: 'var(--danger)', borderColor: 'var(--danger)' } : {}, onClick: () => toggleSaborAgotado(cat, sabor) },
    agotado ? '🚫 ' + sabor + ' — Reponer' : sabor + ' — Marcar agotado'
    );
  })
  )
  )),
  categoriasConSabor.length === 0 && categoriasDeProductos.length === 0 && /*#__PURE__*/React.createElement("p", { className: "small" }, "No hay categor\xEDas con sabores configuradas para este panel."),
  categoriasDeProductos.length > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/
  React.createElement("h2", { style: { marginTop: 26, marginBottom: 6 } }, "Bebidas preparadas"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Estas bebidas se piden seguido y se pueden terminar \u2014 m\xE1rcalas agotadas cuando ya no tengas c\xF3mo prepararlas (ej. sin pi\xF1a, sin fresa, sin menta para el mojito)."),
  categoriasDeProductos.map((cat) => /*#__PURE__*/React.createElement("div", { key: cat.id, className: "card", style: { marginBottom: 14 } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, cat.nombre), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { flexWrap: 'wrap', gap: 10 } },
  cat.productos.map((p) => /*#__PURE__*/React.createElement("button", { key: p.id, className: 'btn btn-sm ' + (p.agotado ? 'btn-primary' : 'btn-secondary'), style: p.agotado ? { background: 'var(--danger)', borderColor: 'var(--danger)' } : {}, onClick: () => toggleProductoAgotado(cat, p) },
  p.agotado ? '🚫 ' + p.nombre + ' — Reponer' : p.nombre + ' — Marcar agotado'
  ))
  )
  ))
  )
  );
}
// Cuentas abiertas: clientes que eligieron "Agregar a mi cuenta" en vez de pagar al momento. El Mesero o el
// Cantinero pueden cobrar y cerrar la cuenta en cualquier momento; las que están "solicitando pago" se resaltan.
// Pantalla de cobro para una cuenta abierta: elegir método, calcular cambio (efectivo) o confirmar comprobante
// (transferencia), y al confirmar: genera el ticket, marca como pagadas (en state.sales) TODAS las ventas que
// formaban la cuenta para que el corte de caja las sume correctamente, y registra quién hizo el cobro.
function PantallaCobroCuenta({ cuenta, quien, onCerrar }) {
  const { updateItem, setState, crearFolioYTicket, log, toast } = useStore();
  const [metodoCobro, setMetodoCobro] = useState(cuenta.metodoPagoSolicitado || 'efectivo');
  const [recibido, setRecibido] = useState('');
  const [comprobanteConfirmado, setComprobanteConfirmado] = useState(false);
  const cambio = metodoCobro === 'efectivo' && recibido !== '' ? Math.max(0, Number(recibido) - cuenta.total) : 0;
  const faltaParaCubrir = metodoCobro === 'efectivo' && recibido !== '' ? Math.max(0, cuenta.total - Number(recibido)) : 0;

  function confirmarCobro() {
    if (metodoCobro === 'efectivo') {
      if (recibido === '' || Number(recibido) < cuenta.total) {toast('La cantidad recibida debe cubrir el total de ' + money(cuenta.total));return;}
    } else if (!comprobanteConfirmado) {
      toast('Confirma que ya se recibió el comprobante de transferencia antes de cerrar la cuenta.');
      return;
    }
    const metodoPagoTexto = metodoCobro === 'efectivo' ? 'Efectivo' : 'Transferencia';
    const folio = crearFolioYTicket('CTA', {
      clienteNombre: cuenta.clienteNombre, clienteEmail: cuenta.clienteEmail,
      tipoPedido: 'Cuenta abierta',
      items: cuenta.items.map((i) => ({ nombre: i.nombre, cantidad: i.cantidad, total: i.total })),
      subtotal: cuenta.total, descuento: 0, total: cuenta.total,
      metodoPago: metodoPagoTexto,
      pagoRecibido: metodoCobro === 'efectivo' ? Number(recibido) : undefined,
      cambio: metodoCobro === 'efectivo' ? cambio : undefined,
      estadoPago: 'Pagado (cuenta cerrada)', estadoPedido: 'Entregado',
      responsableCobro: quien
    });
    // Marca como pagadas, con el método real elegido, TODAS las ventas que integraban la cuenta — así el
    // corte de caja (que suma de state.sales) las cuenta en efectivo o transferencia según corresponda.
    cuenta.items.forEach((i) => {
      updateItem('sales', i.ventaId, { pago: metodoCobro, estadoPago: 'confirmado', folio, responsableCobro: quien, horaCobro: nowTime(), cambio: metodoCobro === 'efectivo' ? cambio : 0 });
    });
    setState((s) => ({ ...s, cuentasAbiertas: s.cuentasAbiertas.map((x) => x.id !== cuenta.id ? x : { ...x, estado: 'cerrada', folio, metodoPagoFinal: metodoCobro, montoRecibido: metodoCobro === 'efectivo' ? Number(recibido) : cuenta.total, cambioEntregado: metodoCobro === 'efectivo' ? cambio : 0, responsableCobro: quien, horaCierre: nowTime() }) }));
    log(quien, 'Cobró y cerró la cuenta de ' + cuenta.clienteNombre + ' — ' + metodoPagoTexto + ' — folio ' + folio + ' — ' + money(cuenta.total));
    toast('✅ Cuenta cobrada y cerrada — folio ' + folio + (metodoCobro === 'efectivo' ? ' · Cambio entregado: ' + money(cambio) : ''));
    onCerrar();
  }

  return /*#__PURE__*/React.createElement("div", { className: "modal-bg", onClick: onCerrar }, /*#__PURE__*/
  React.createElement("div", { className: "modal", onClick: (e) => e.stopPropagation() }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "\uD83D\uDCB0 Cobrar cuenta \u2014 ", cuenta.tipo === 'mesa' ? 'Mesa ' + cuenta.mesaNumero + ' (' + cuenta.zona + ')' : cuenta.clienteNombre), /*#__PURE__*/
  React.createElement("div", { className: "small", style: { fontWeight: 700, marginBottom: 4 } }, "Resumen del consumo"), /*#__PURE__*/
  React.createElement("table", { style: { marginBottom: 6 } }, /*#__PURE__*/React.createElement("tbody", null,
  cuenta.items.map((i, idx) => /*#__PURE__*/React.createElement("tr", { key: idx }, /*#__PURE__*/React.createElement("td", null, i.nombre, " x", i.cantidad), /*#__PURE__*/React.createElement("td", { style: { textAlign: 'right' } }, money(i.total))))
  )), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { fontWeight: 800, fontSize: 18, marginBottom: 14, paddingTop: 8, borderTop: '1px solid var(--line)' } }, /*#__PURE__*/React.createElement("span", null, "Total a cobrar"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", null, money(cuenta.total))), /*#__PURE__*/

  React.createElement(Field, { label: "M\xE9todo de pago" }, /*#__PURE__*/
  React.createElement("select", { value: metodoCobro, onChange: (e) => {setMetodoCobro(e.target.value);setRecibido('');setComprobanteConfirmado(false);} }, /*#__PURE__*/
  React.createElement("option", { value: "efectivo" }, "Efectivo"), /*#__PURE__*/
  React.createElement("option", { value: "transferencia" }, "Transferencia")
  )
  ),

  metodoCobro === 'efectivo' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/
  React.createElement(Field, { label: "\xBFCon cu\xE1nto pag\xF3 el cliente?" }, /*#__PURE__*/React.createElement("input", { type: "number", value: recibido, onChange: (e) => setRecibido(e.target.value), placeholder: 'Mínimo ' + cuenta.total })),
  recibido !== '' && Number(recibido) >= cuenta.total && /*#__PURE__*/React.createElement("div", { style: { textAlign: 'center', margin: '14px 0' } }, /*#__PURE__*/
  React.createElement("div", { className: "small" }, "Cambio a devolver"), /*#__PURE__*/
  React.createElement("div", { style: { fontSize: 34, fontWeight: 900, color: 'var(--ok)' } }, money(cambio))
  ),
  recibido !== '' && Number(recibido) < cuenta.total && /*#__PURE__*/React.createElement("div", { className: "alert danger", style: { marginTop: 10 } }, "\u26A0\uFE0F Faltan ", money(faltaParaCubrir), " para cubrir el total.")
  ),

  metodoCobro === 'transferencia' && /*#__PURE__*/React.createElement("div", { className: "card", style: { background: 'var(--bg-soft)', marginTop: 10 } }, /*#__PURE__*/
  React.createElement("div", { className: "small" }, "Monto esperado por transferencia: ", /*#__PURE__*/React.createElement("strong", null, money(cuenta.total))), /*#__PURE__*/
  React.createElement("label", { className: "flexrow", style: { gap: 8, marginTop: 10, cursor: 'pointer' } }, /*#__PURE__*/
  React.createElement("input", { type: "checkbox", style: { width: 'auto' }, checked: comprobanteConfirmado, onChange: (e) => setComprobanteConfirmado(e.target.checked) }), /*#__PURE__*/
  React.createElement("span", { className: "small" }, "Ya revis\xE9 y recib\xED el comprobante de la transferencia")
  )
  ), /*#__PURE__*/

  React.createElement("div", { className: "flexrow", style: { gap: 8, marginTop: 18 } }, /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", onClick: confirmarCobro }, "\u2705 Confirmar cobro"), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-ghost", onClick: onCerrar }, "Cancelar")
  )
  )
  );
}
function CuentasAbiertasPanel() {
  const { state } = useStore();
  const [cobrando, setCobrando] = useState(null);
  const quien = (state.staff.find((s) => s.id === state.staffSession) || {}).nombre || 'Personal de turno';
  const todas = state.cuentasAbiertas || [];
  const abiertas = [...todas.filter((t) => t.estado !== 'cerrada')].sort((a, b) => (a.estado === 'solicitando_pago' ? 0 : 1) - (b.estado === 'solicitando_pago' ? 0 : 1));
  const cerradasHoy = todas.filter((t) => t.estado === 'cerrada' && t.fechaApertura === todayISO());

  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Cuentas abiertas"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Clientes que eligieron \"Agregar a mi cuenta\" en vez de pagar al momento de ordenar. C\xF3brales cuando terminen, o cuando ellos mismos soliciten el pago desde su app."),
  abiertas.length === 0 && /*#__PURE__*/React.createElement("p", { className: "small" }, "No hay cuentas abiertas por ahora."),
  abiertas.map((t) => /*#__PURE__*/React.createElement("div", { key: t.id, className: "card", style: { marginBottom: 14, borderColor: t.estado === 'solicitando_pago' ? 'var(--danger)' : undefined } }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow" }, /*#__PURE__*/React.createElement("strong", null, t.tipo === 'mesa' ? '🪑 Mesa ' + t.mesaNumero + ' (' + t.zona + ')' : '👤 ' + t.clienteNombre), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/
  React.createElement("span", { className: 'tag ' + (t.estado === 'solicitando_pago' ? 'danger' : 'warn') }, t.estado === 'solicitando_pago' ? '🔴 Solicita pago (' + (t.metodoPagoSolicitado === 'efectivo' ? 'Efectivo' : 'Transferencia') + ')' : '🟡 Cuenta abierta')
  ),
  t.tipo === 'mesa' && /*#__PURE__*/React.createElement("div", { className: "small", style: { marginTop: 2 } }, "Abierta por: ", t.abiertaPor), /*#__PURE__*/
  React.createElement("table", { style: { marginTop: 8 } }, /*#__PURE__*/React.createElement("tbody", null,
  t.items.map((i, idx) => /*#__PURE__*/React.createElement("tr", { key: idx }, /*#__PURE__*/React.createElement("td", null, i.nombre, " x", i.cantidad), /*#__PURE__*/React.createElement("td", { style: { textAlign: 'right' } }, money(i.total))))
  )), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { marginTop: 8, fontWeight: 800 } }, /*#__PURE__*/React.createElement("span", null, "Total"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", null, money(t.total))), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary btn-sm", style: { marginTop: 10 }, onClick: () => setCobrando(t) }, "\uD83D\uDCB0 Cobrar y cerrar cuenta")
  )),
  cerradasHoy.length > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 20 } }, "Cerradas hoy"), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/React.createElement(DataTable, { columns: [
    { key: 'clienteNombre', label: 'Cliente' }, { key: 'total', label: 'Total', render: (r) => money(r.total) },
    { key: 'metodoPagoFinal', label: 'Método', render: (r) => r.metodoPagoFinal === 'efectivo' ? 'Efectivo' : 'Transferencia' },
    { key: 'montoRecibido', label: 'Recibió', render: (r) => r.metodoPagoFinal === 'efectivo' ? money(r.montoRecibido || r.total) : '—' },
    { key: 'cambioEntregado', label: 'Cambio', render: (r) => r.metodoPagoFinal === 'efectivo' ? money(r.cambioEntregado || 0) : '—' },
    { key: 'responsableCobro', label: 'Cobró' }, { key: 'folio', label: 'Folio' }, { key: 'horaCierre', label: 'Hora' }],
    rows: [...cerradasHoy].reverse() }))
  ),
  cobrando && /*#__PURE__*/React.createElement(PantallaCobroCuenta, { cuenta: cobrando, quien: quien, onCerrar: () => setCobrando(null) })
  );
}
function BarDashboard({ goto }) {
  const { state } = useStore();
  const pedidosHoy = state.sales.filter((s) => s.fecha === todayISO() && s.categoria !== 'Alitas' && s.categoria !== 'Snacks y botanas' && s.estadoPedido !== 'Entregado' && s.estadoPedido !== 'Cancelado');
  const insumosAlerta = state.insumos.filter((i) => i.area === 'cantinero' && i.stock < i.minimo);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Panel del Cantinero"), /*#__PURE__*/
  React.createElement(StockAlertBanner, null), /*#__PURE__*/
  React.createElement(CortesiasBanner, null), /*#__PURE__*/
  React.createElement(PedidosListosBanner, null), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-3", style: { marginBottom: 16 } }, /*#__PURE__*/
  React.createElement(KpiCard, { label: "Pedidos en preparaci\xF3n", icon: "\uD83C\uDF78", value: pedidosHoy.length }), /*#__PURE__*/
  React.createElement(KpiCard, { label: "Bebidas por rellenar", icon: "\u267B\uFE0F", value: 0 }), /*#__PURE__*/
  React.createElement(KpiCard, { label: "Insumos en alerta", icon: "\u26A0\uFE0F", value: insumosAlerta.length })
  ), /*#__PURE__*/
  React.createElement("div", { className: "qa-grid", style: { marginBottom: 16 } }, /*#__PURE__*/
  React.createElement(QuickAction, { icon: "\uD83D\uDCE3", label: "Reportar faltante", onClick: () => goto('faltante') }), /*#__PURE__*/
  React.createElement(QuickAction, { icon: "\uD83D\uDCF7", label: "Subir imagen de producto", onClick: () => goto('imagenes') }), /*#__PURE__*/
  React.createElement(QuickAction, { icon: "\u2B50", label: "Evaluar cierre de hoy", onClick: () => goto('evaluar') })
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/React.createElement("h3", { style: { marginTop: 0 } }, "Pedidos activos"), /*#__PURE__*/React.createElement(DataTable, { columns: [{ key: 'hora', label: 'Hora' }, { key: 'producto', label: 'Producto' }, { key: 'variante', label: 'Variante' }, { key: 'mesero', label: 'Mesero', render: (r) => infoMeseroCliente(r).mesero }, { key: 'cliente', label: 'Cliente', render: (r) => infoMeseroCliente(r).cliente }], rows: [...pedidosHoy].reverse() })), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginTop: 14 } }, /*#__PURE__*/React.createElement("h3", { style: { marginTop: 0 } }, "\uD83C\uDF57 Fila de cocina (para coordinar la entrega con las bebidas)"), /*#__PURE__*/
  React.createElement(DataTable, { emptyText: "Sin comandas en fila.", columns: [
    { key: 'turno', label: '#', render: (r) => '#' + (comandasEnCola(state).findIndex((c) => c.id === r.id) + 1) },
    { key: 'hora', label: 'Hora' }, { key: 'producto', label: 'Producto' },
    { key: 'mesero', label: 'Mesero', render: (r) => infoMeseroCliente(r).mesero },
    { key: 'cliente', label: 'Cliente', render: (r) => infoMeseroCliente(r).cliente },
    { key: 'tiempo', label: 'Tiempo estimado', render: (r) => /*#__PURE__*/React.createElement(BarraProgresoCocina, { venta: r }) },
    { key: 'estadoPedido', label: 'Estado', render: (r) => /*#__PURE__*/React.createElement("span", { className: 'tag ' + (r.estadoPedido === 'En preparación' ? 'warn' : 'info') }, r.estadoPedido || 'Pedido recibido') }],
    rows: comandasEnCola(state) })
  ), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginTop: 14 } }, /*#__PURE__*/React.createElement("h3", { style: { marginTop: 0 } }, "Cat\xE1logo (solo lectura)"), /*#__PURE__*/React.createElement(CatalogoLectura, null))
  );
}
function BarPreparacion() {
  const { state, updateItem, notify, toast } = useStore();
  const pendientes = [...state.sales.filter((s) => s.categoria !== 'Alitas' && s.categoria !== 'Snacks y botanas' && s.estadoPedido !== 'Entregado' && s.estadoPedido !== 'Cancelado')].
  sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
  const [demorandoId, setDemorandoId] = useState('');
  const [minutos, setMinutos] = useState('15');
  const [motivo, setMotivo] = useState('');
  const [cancelando, setCancelando] = useState(null);
  const [editando, setEditando] = useState(null);
  const demorando = pendientes.find((p) => p.id === demorandoId) || null;
  const modificadosPorMesero = pendientes.filter((p) => p.ultimaEdicionPor === 'mesero' && p.estadoPedido === 'Pedido recibido');

  function avanzar(v) {
    const siguiente = v.estadoPedido === 'Pedido recibido' ? 'En preparación' : v.estadoPedido === 'En preparación' ? 'Listo' : 'Entregado';
    updateItem('sales', v.id, { estadoPedido: siguiente });
    if (siguiente === 'Listo') {
      if (v.entrega === 'llevar' && v.clienteEmail) {
        notify({ tipo: 'pedido_listo', destino: 'cliente', clienteEmail: v.clienteEmail, clienteNombre: v.clienteNombre, producto: v.producto, cantidad: v.cantidad, mesaNumero: v.mesaNumero, ventaId: v.id, atendido: false, origen: 'barra' });
        toast('🥤 Se avisó al cliente que su ' + v.producto + ' ya está lista para llevar');
      } else {
        notify({ tipo: 'pedido_listo', destino: 'mesero', mesero: v.mesero, producto: v.producto, cantidad: v.cantidad, mesaNumero: v.mesaNumero, entrega: v.entrega, ventaId: v.id, atendido: false, origen: 'barra' });
        toast('🔔 Se avisó a ' + v.mesero + ' para que pase a la barra por ' + v.producto + (v.mesaNumero ? ' (Mesa ' + v.mesaNumero + ')' : ''));
      }
    } else {
      toast('Actualizado a: ' + siguiente);
    }
  }

  function enviarDemora() {
    if (!demorando) {toast('Selecciona el pedido');return;}
    if (!motivo.trim()) {toast('Escribe el motivo de la demora');return;}
    if (demorando.entrega === 'llevar' && demorando.clienteEmail) {
      notify({ tipo: 'aviso_demora', destino: 'cliente', clienteEmail: demorando.clienteEmail, clienteNombre: demorando.clienteNombre, producto: demorando.producto, minutos: Number(minutos), motivo, ventaId: demorando.id, atendido: false });
    } else {
      notify({ tipo: 'aviso_demora', destino: 'mesero', mesero: demorando.mesero, producto: demorando.producto, mesaNumero: demorando.mesaNumero, minutos: Number(minutos), motivo, ventaId: demorando.id, atendido: false });
    }
    toast('⏳ Aviso de demora enviado');
    setDemorandoId('');setMotivo('');
  }

  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Pedidos en preparaci\xF3n (bebidas)"), /*#__PURE__*/
  React.createElement("div", { className: "alert", style: { marginBottom: 14 } }, "\u23F1\uFE0F Micheladas: ", /*#__PURE__*/React.createElement("strong", null, "5\u201310 min"), " (puede tardar m\xE1s si hay pedidos por delante) \xB7 Mojitos / Medias de seda / otras bebidas preparadas: ", /*#__PURE__*/React.createElement("strong", null, "~15 min"), "."), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Tienes ", /*#__PURE__*/React.createElement("strong", null, pendientes.filter((p) => p.estadoPedido !== 'Listo').length), " pedido(s) de bebida por delante ahora mismo."),
  modificadosPorMesero.length > 0 && /*#__PURE__*/React.createElement("div", { className: "alert", style: { marginBottom: 12, borderColor: 'var(--warn)' } }, "\u26A0\uFE0F ", /*#__PURE__*/React.createElement("strong", null, modificadosPorMesero.length, " pedido(s) modificado(s) por el mesero"), " \u2014 revisa antes de preparar (resaltados abajo)."), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/React.createElement(DataTable, { emptyText: "Sin pedidos de bebida pendientes.", rowStyle: (r) => r.ultimaEdicionPor === 'mesero' && r.estadoPedido === 'Pedido recibido' ? { background: 'rgba(255,152,0,.12)' } : undefined, columns: [
    { key: 'hora', label: 'Hora' }, { key: 'mesaNumero', label: 'Mesa', render: (r) => r.mesaNumero || '—' },
    { key: 'producto', label: 'Producto', render: (r) => /*#__PURE__*/React.createElement("div", null, r.producto, r.notas ? /*#__PURE__*/React.createElement("div", { className: "small" }, "\uD83D\uDCDD ", r.notas) : null, /*#__PURE__*/React.createElement(AvisoPedidoModificado, { venta: r, quien: "bartender" })) }, { key: 'cantidad', label: 'Cant.' },
    { key: 'mesero', label: 'Mesero', render: (r) => infoMeseroCliente(r).mesero },
    { key: 'cliente', label: 'Cliente', render: (r) => infoMeseroCliente(r).cliente },
    { key: 'entrega', label: 'Entrega', render: (r) => r.entrega === 'llevar' ? 'Para llevar' : r.entrega === 'domicilio' ? 'A domicilio' : 'Consumo en local' },
    { key: 'tiempo', label: 'Tiempo estimado', render: (r) => tiempoPreparacionBebida(r.categoria) || 'Inmediato' },
    { key: 'estadoPedido', label: 'Estado', render: (r) => /*#__PURE__*/React.createElement("span", { className: 'tag ' + (r.estadoPedido === 'Listo' || r.estadoPedido === 'Entregado' ? 'ok' : r.estadoPedido === 'En preparación' ? 'warn' : 'info') }, r.estadoPedido || 'Pedido recibido') },
    { key: 'acciones', label: '', render: (r) => /*#__PURE__*/React.createElement("div", { className: "flexrow", style: { gap: 6, flexWrap: 'wrap' } }, /*#__PURE__*/
      React.createElement(AccionesEdicionPedido, { venta: r, quien: "bartender", onEditar: setEditando }), /*#__PURE__*/
      React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: (e) => {e.stopPropagation();setCancelando(r);} }, "\u274C Cancelar")
      ) }],
    rows: pendientes, onView: (v) => v.estadoPedido !== 'Entregado' && avanzar(v) })), /*#__PURE__*/
  React.createElement(ModalCancelarPedido, { venta: cancelando, quien: "Cantinero", onCerrar: () => setCancelando(null) }), /*#__PURE__*/
  React.createElement(ModalEditarPedido, { venta: editando, quien: "bartender", onCerrar: () => setEditando(null) }), /*#__PURE__*/
  React.createElement("p", { className: "small", style: { marginTop: 8 } }, "Clic en \"Ver\" para avanzar el estado (Pedido recibido \u2192 En preparaci\xF3n \u2192 Listo \u2192 Entregado). Al marcar \"Listo\": si es para llevar se avisa al cliente; si es para consumir ah\xED, se avisa al mesero para que pase a la barra por ella."), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginTop: 14, maxWidth: 560 } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "\u23F3 Avisar demora por pedidos acumulados"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Si tienes varios pedidos por delante, avisa al mesero o al cliente cu\xE1nto va a tardar su bebida y por qu\xE9 (ej. \"Tengo 5 pedidos por delante\")."), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-2" }, /*#__PURE__*/
  React.createElement(Field, { label: "Selecciona el pedido" }, /*#__PURE__*/React.createElement("select", { value: demorandoId, onChange: (e) => setDemorandoId(e.target.value) }, /*#__PURE__*/
  React.createElement("option", { value: "" }, "Selecciona\u2026"),
  pendientes.filter((p) => p.estadoPedido !== 'Listo' && p.estadoPedido !== 'Entregado').map((p) => /*#__PURE__*/React.createElement("option", { key: p.id, value: p.id }, (p.mesaNumero ? 'Mesa ' + p.mesaNumero + ' — ' : '') + p.producto + ' (' + p.mesero + ')'))
  )), /*#__PURE__*/
  React.createElement(Field, { label: "Minutos estimados de demora" }, /*#__PURE__*/React.createElement("input", { type: "number", value: minutos, onChange: (e) => setMinutos(e.target.value) }))
  ), /*#__PURE__*/
  React.createElement(Field, { label: "Motivo" }, /*#__PURE__*/React.createElement("input", { placeholder: "Ej. Tengo 5 pedidos diferentes por delante", value: motivo, onChange: (e) => setMotivo(e.target.value) })), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary btn-sm", style: { marginTop: 8 }, disabled: !demorando, onClick: enviarDemora }, "Enviar aviso de demora")
  )
  );
}
function BarRellenos() {
  const { state, notify, updateItem, toast } = useStore();
  const [mesa, setMesa] = useState('');const [detalle, setDetalle] = useState('');
  const rellenos = state.notifications.filter((n) => n.tipo === 'relleno');
  const pendientes = rellenos.filter((n) => !n.atendido);
  const atendidos = rellenos.filter((n) => n.atendido);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, "Rellenos pendientes (pedidos grandes)"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Notifica al mesero en turno cuando una mesa con pedido grande necesite que le rellenen una bebida. El mesero lo ver\xE1 como alerta en su panel y podr\xE1 marcarlo como atendido."), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { maxWidth: 420, marginBottom: 16 } }, /*#__PURE__*/
  React.createElement(Field, { label: "Mesa / pedido" }, /*#__PURE__*/React.createElement("input", { value: mesa, onChange: (e) => setMesa(e.target.value) })), /*#__PURE__*/
  React.createElement(Field, { label: "Qu\xE9 falta rellenar" }, /*#__PURE__*/React.createElement("input", { value: detalle, onChange: (e) => setDetalle(e.target.value) })), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", style: { marginTop: 10 }, onClick: () => {if (!mesa || !detalle) return;notify({ tipo: 'relleno', mesa, detalle, atendido: false });toast('🔔 Aviso de relleno enviado al mesero en turno');setMesa('');setDetalle('');} }, "Notificar relleno")
  ), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginBottom: 16 } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "\uD83D\uDFE1 Pendientes (", pendientes.length, ")"), /*#__PURE__*/
  React.createElement(DataTable, { emptyText: "No hay rellenos pendientes.", columns: [{ key: 'hora', label: 'Hora' }, { key: 'mesa', label: 'Mesa/pedido' }, { key: 'detalle', label: 'Detalle' }], rows: [...pendientes].reverse() })
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "\u2705 Atendidos (", atendidos.length, ")"), /*#__PURE__*/
  React.createElement(DataTable, { emptyText: "A\xFAn no hay rellenos atendidos.", columns: [{ key: 'hora', label: 'Hora' }, { key: 'mesa', label: 'Mesa/pedido' }, { key: 'detalle', label: 'Detalle' }], rows: [...atendidos].reverse() })
  )
  );
}
function BarPropinas() {
  const { state, pushTo, updateItem, removeItem, toast } = useStore();
  const [monto, setMonto] = useState('');
  const [fecha, setFecha] = useState(todayISO());
  const [modo, setModo] = useState('equitativo'); // equitativo | horas | mesero

  const meseros = state.staff.filter((s) => s.rol === 'mesero');
  const bartenders = state.staff.filter((s) => s.rol === 'bartender');
  const cocineras = state.staff.filter((s) => s.rol === 'cocinera');
  const apoyo = [...bartenders, ...cocineras]; // bartender + cocinera comparten la parte fija en el modo "por mesero"
  const participantes = [...meseros, ...apoyo]; // los meseros + el bartender + la cocinera

  function calcularReparto(montoTotal) {
    if (participantes.length === 0) return [];
    if (modo === 'equitativo') {
      const porPersona = montoTotal / participantes.length;
      return participantes.map((p) => ({ nombre: p.nombre, rol: p.rol, monto: porPersona }));
    }
    if (modo === 'horas') {
      // Aproximación de horas trabajadas por turno estándar (sección 17)
      const horasDe = (p) => {
        if (p.entrada === '—' || !p.entrada) return 8;
        const [h1, m1] = p.entrada.split(':').map(Number);
        const [h2, m2] = (p.salida || '23:00').split(':').map(Number);
        return Math.max(1, h2 + m2 / 60 - (h1 + m1 / 60));
      };
      const totalHoras = participantes.reduce((a, p) => a + horasDe(p), 0);
      return participantes.map((p) => ({ nombre: p.nombre, rol: p.rol, monto: montoTotal * (horasDe(p) / totalHoras) }));
    }
    // por mesero: el bartender y la cocinera reciben juntos una parte fija (20%, repartida entre ellos) y el
    // resto se reparte entre meseros según mesas atendidas (mock: equitativo entre meseros)
    const partesApoyo = montoTotal * 0.2;
    const restante = montoTotal - partesApoyo;
    const porMesero = meseros.length ? restante / meseros.length : 0;
    const porApoyo = apoyo.length ? partesApoyo / apoyo.length : 0;
    return [
    ...apoyo.map((b) => ({ nombre: b.nombre, rol: b.rol, monto: porApoyo })),
    ...meseros.map((m) => ({ nombre: m.nombre, rol: m.rol, monto: porMesero }))];

  }

  function registrar() {
    const m = Number(monto);
    if (!m || m <= 0) {toast('Ingresa un monto de propina válido');return;}
    const reparto = calcularReparto(m);
    pushTo('tips', { id: uid('tip'), fecha, monto: m, modo, reparto });
    toast('💵 Propina registrada y repartida entre ' + participantes.length + ' personas');
    setMonto('');
  }

  const historial = [...state.tips].reverse();
  const totalHistorico = state.tips.reduce((a, t) => a + t.monto, 0);
  const porPersonaHistorico = {};
  state.tips.forEach((t) => t.reparto.forEach((r) => {porPersonaHistorico[r.nombre] = (porPersonaHistorico[r.nombre] || 0) + r.monto;}));

  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Propinas y reparto"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Las propinas se dividen entre los meseros, el bartender y la cocinera. Elige el modo de reparto: equitativo, por horas trabajadas, o con una parte fija para bartender/cocinera y el resto entre meseros."), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-2" }, /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Registrar propina"), /*#__PURE__*/
  React.createElement("div", { className: "grid", style: { gap: 10 } }, /*#__PURE__*/
  React.createElement(Field, { label: "Fecha" }, /*#__PURE__*/React.createElement("input", { type: "date", value: fecha, onChange: (e) => setFecha(e.target.value) })), /*#__PURE__*/
  React.createElement(Field, { label: "Monto de la propina" }, /*#__PURE__*/React.createElement("input", { type: "number", value: monto, onChange: (e) => setMonto(e.target.value) })), /*#__PURE__*/
  React.createElement(Field, { label: "Modo de reparto" }, /*#__PURE__*/React.createElement("select", { value: modo, onChange: (e) => setModo(e.target.value) }, /*#__PURE__*/
  React.createElement("option", { value: "equitativo" }, "Equitativo (todos por igual)"), /*#__PURE__*/
  React.createElement("option", { value: "horas" }, "Por horas trabajadas"), /*#__PURE__*/
  React.createElement("option", { value: "mesero" }, "Bartender 20% fijo + resto entre meseros")
  )),
  monto > 0 && /*#__PURE__*/React.createElement("div", { className: "card", style: { background: 'var(--bg-soft)' } }, /*#__PURE__*/
  React.createElement("div", { className: "small", style: { fontWeight: 700, marginBottom: 6 } }, "Vista previa del reparto:"),
  calcularReparto(Number(monto)).map((r, i) => /*#__PURE__*/React.createElement("div", { key: i, className: "flexrow small" }, /*#__PURE__*/React.createElement("span", null, r.nombre, " (", r.rol, ")"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", null, money(r.monto))))
  ), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", onClick: registrar }, "Registrar y repartir")
  )
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Total acumulado por persona"),
  Object.keys(porPersonaHistorico).length === 0 && /*#__PURE__*/React.createElement("p", { className: "small" }, "Sin propinas registradas a\xFAn."),
  Object.entries(porPersonaHistorico).map(([nombre, monto]) => /*#__PURE__*/React.createElement("div", { key: nombre, className: "flexrow small" }, /*#__PURE__*/React.createElement("span", null, nombre), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("strong", null, money(monto)))), /*#__PURE__*/
  React.createElement("hr", { className: "line" }), /*#__PURE__*/
  React.createElement("div", { className: "flexrow" }, /*#__PURE__*/React.createElement("strong", null, "Total repartido"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("strong", null, money(totalHistorico)))
  )
  ), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginTop: 14 } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Historial de propinas por turno"),
  historial.length === 0 && /*#__PURE__*/React.createElement("p", { className: "small" }, "Sin registros."),
  historial.map((t) => /*#__PURE__*/React.createElement("div", { key: t.id, className: "flexrow", style: { marginBottom: 8, borderBottom: '1px solid var(--line)', paddingBottom: 8 } }, /*#__PURE__*/
  React.createElement("div", { style: { flex: 1 } }, /*#__PURE__*/
  React.createElement("div", { className: "small" }, /*#__PURE__*/React.createElement("strong", null, t.fecha), " \u2014 ", money(t.monto), " (", t.modo, ")"), /*#__PURE__*/
  React.createElement("div", { className: "small" }, t.reparto.map((r) => r.nombre + ': ' + money(r.monto)).join(' · '))
  ), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => removeItem('tips', t.id) }, "Eliminar")
  ))
  )
  );
}
function BarFondoCaja() {
  const { state } = useStore();
  const hoy = todayISO();
  const { asignado, gastado, saldo } = fondoCajaDelDia(state, hoy);
  const gastosDelFondo = state.expenses.filter((e) => e.fecha === hoy && e.origen === 'fondo_caja');
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Fondo de caja"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Esto es lo que el administrador te dej\xF3 hoy para operar la caja, y lo que se ha tomado de ah\xED (por ejemplo, si el administrador compra hielo y lo saca del fondo)."), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-3", style: { marginBottom: 16 } }, /*#__PURE__*/
  React.createElement(KpiCard, { label: "Fondo asignado hoy", icon: "\uD83C\uDFE6", value: money(asignado) }), /*#__PURE__*/
  React.createElement(KpiCard, { label: "Gastado del fondo", icon: "\uD83D\uDCB8", value: money(gastado) }), /*#__PURE__*/
  React.createElement(KpiCard, { label: "Saldo disponible", icon: "\uD83D\uDCB0", value: money(saldo) })
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Gastos tomados de tu fondo hoy"), /*#__PURE__*/
  React.createElement(DataTable, { emptyText: "Sin gastos tomados del fondo hoy.", columns: [{ key: 'hora', label: 'Hora' }, { key: 'concepto', label: 'Concepto' }, { key: 'categoria', label: 'Categoría' }, { key: 'monto', label: 'Monto', render: (r) => money(r.monto) }], rows: gastosDelFondo })
  ), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginTop: 14 } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Historial completo de entregas"), /*#__PURE__*/
  React.createElement(DataTable, { emptyText: "A\xFAn no se te ha entregado ning\xFAn fondo.", columns: [{ key: 'fecha', label: 'Fecha' }, { key: 'monto', label: 'Monto', render: (r) => money(r.monto) }, { key: 'nota', label: 'Nota', render: (r) => r.nota || '—' }], rows: [...state.cashFunds].reverse() })
  )
  );
}

// Pantalla de confirmación de contraseña: protege el acceso al corte de caja. Un intento fallido queda
// registrado en la bitácora del administrador con hora y nombre de quien lo intentó.
function CandadoCorteCaja({ onDesbloquear }) {
  const { state, log, toast } = useStore();
  const [pwd, setPwd] = useState('');
  const quien = state.staff.find((s) => s.id === state.staffSession);
  function confirmar() {
    if (!quien) {toast('No se encontró tu sesión');return;}
    if (pwd === quien.password) {onDesbloquear();setPwd('');} else
    {
      log(quien.nombre, '🔒 Intento fallido de acceso al corte de caja (contraseña incorrecta)');
      toast('❌ Contraseña incorrecta — acceso denegado. Se registró el intento.');
      setPwd('');
    }
  }
  return /*#__PURE__*/React.createElement("div", { className: "card", style: { maxWidth: 420, margin: '40px auto', textAlign: 'center' } }, /*#__PURE__*/
  React.createElement("div", { style: { fontSize: 34, marginBottom: 6 } }, "\uD83D\uDD12"), /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Confirma tu contrase\xF1a"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Por seguridad, el corte de caja pide confirmar tu contrase\xF1a antes de mostrar cualquier dato."), /*#__PURE__*/
  React.createElement("input", { type: "password", value: pwd, onChange: (e) => setPwd(e.target.value), onKeyDown: (e) => e.key === 'Enter' && confirmar(), placeholder: "Tu contrase\xF1a", style: { marginTop: 10 } }), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", style: { marginTop: 12, width: '100%' }, onClick: confirmar }, "Entrar al corte de caja")
  );
}
function BarCorteCaja() {
  const { state, setState, pushTo, notify, log, toast } = useStore();
  // IMPORTANTE: todos los useState del componente van primero, antes de cualquier "return" anticipado
  // (candado de contraseña / bloqueo por responsable), para no romper las reglas de los Hooks de React.
  const [desbloqueado, setDesbloqueado] = useState(false);
  const [efectivoContado, setEfectivoContado] = useState('');
  const [conteo, setConteo] = useState(() => Object.fromEntries(DENOMINACIONES.map((d) => [d, 0])));
  const [notaJustificacion, setNotaJustificacion] = useState('');
  const hoy = todayISO();
  const quien = state.staff.find((s) => s.id === state.staffSession);
  const responsable = state.corteCajaResponsableHoy && state.corteCajaResponsableHoy.fecha === hoy ? state.corteCajaResponsableHoy : null;

  if (!desbloqueado) return /*#__PURE__*/React.createElement(CandadoCorteCaja, { onDesbloquear: () => {
      // Solo el primer bartender que entra con éxito en el día queda como responsable del corte; los demás quedan bloqueados.
      if (!responsable) {
        setState({ corteCajaResponsableHoy: { bartenderId: quien.id, nombre: quien.nombre, fecha: hoy } });
        setDesbloqueado(true);
      } else if (responsable.bartenderId === quien.id) {
        setDesbloqueado(true);
      } else {
        log(quien.nombre, '🚫 Intentó acceder al corte de caja, pero ya lo abrió ' + responsable.nombre + ' hoy — acceso bloqueado');
        notify({ tipo: 'corte_caja_bloqueado', intento: quien.nombre, responsable: responsable.nombre, hora: nowTime() });
        toast('🚫 Acceso bloqueado: el corte de hoy ya lo abrió ' + responsable.nombre + '. Se notificó al administrador.');
      }
    } });

  if (responsable && responsable.bartenderId !== quien.id) {
    return /*#__PURE__*/React.createElement("div", { className: "card", style: { maxWidth: 420, margin: '40px auto', textAlign: 'center' } }, /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 34, marginBottom: 6 } }, "\uD83D\uDEAB"), /*#__PURE__*/
    React.createElement("h3", { style: { marginTop: 0 } }, "Acceso bloqueado"), /*#__PURE__*/
    React.createElement("p", { className: "small" }, "El corte de caja de hoy corresponde a ", /*#__PURE__*/React.createElement("strong", null, responsable.nombre), ", quien abri\xF3 el turno. El administrador fue notificado de este intento.")
    );
  }

  const { asignado: fondoInicial, gastado: gastoDelFondo } = fondoCajaDelDia(state, hoy);
  const ventasHoy = state.sales.filter((s) => s.fecha === hoy);
  const ventasEfectivo = ventasHoy.filter((s) => s.pago === 'efectivo').reduce((a, s) => a + s.total, 0);
  const ventasTransferencia = ventasHoy.filter((s) => s.pago === 'transferencia').reduce((a, s) => a + s.total, 0);
  const ticketsTransferConfirmados = state.tickets.filter((t) => t.fecha === hoy && t.metodoPago === 'Transferencia' && t.estadoPago === 'Pago confirmado').reduce((a, t) => a + t.total, 0);
  const descuentosCuponHoy = ventasHoy.filter((s) => s.descuento > 0 && state.familiares.includes((s.clienteEmail || '').toLowerCase())).reduce((a, s) => a + s.descuento, 0);
  const efectivoEsperado = fondoInicial + ventasEfectivo - gastoDelFondo;
  const totalContador = DENOMINACIONES.reduce((a, d) => a + d * (Number(conteo[d]) || 0), 0);
  const diferencia = efectivoContado !== '' ? Number(efectivoContado) - efectivoEsperado : null;
  const limite = state.limiteDiferenciaCorte || 200;
  const requiereJustificacion = diferencia !== null && Math.abs(diferencia) > limite;
  const miCorteDeHoy = state.cashCuts.find((c) => c.fecha === hoy && c.bartenderId === quien.id);
  const insumosAReponer = state.insumos.filter((i) => i.area === 'cantinero' && i.stock < i.minimo);

  function cambiarConteo(denom, val) {setConteo((c) => ({ ...c, [denom]: val }));}
  function vaciarAlCorte() {
    setEfectivoContado(String(totalContador));
    toast('💰 ' + money(totalContador) + ' vaciado al corte de caja');
  }
  function reiniciarContador() {setConteo(Object.fromEntries(DENOMINACIONES.map((d) => [d, 0])));}

  function cerrarTurno() {
    if (efectivoContado === '') {toast('Ingresa o vacía el efectivo contado en caja');return;}
    if (requiereJustificacion && !notaJustificacion.trim()) {toast('⚠️ Diferencia mayor a ' + money(limite) + ' detectada — escribe una nota explicando la diferencia antes de confirmar.');return;}
    const cut = { id: uid('cut'), fecha: hoy, hora: nowTime(), bartenderId: quien.id, bartenderNombre: quien.nombre,
      fondoInicial, ventasEfectivo, ventasTransferencia,
      gastoDelFondo, descuentosCuponHoy, efectivoEsperado, efectivoContado: Number(efectivoContado), diferencia,
      denominaciones: { ...conteo }, notaJustificacion: notaJustificacion.trim() || null, notasCorreccion: [] };
    pushTo('cashCuts', cut);
    const diffAbs = Math.abs(diferencia);
    const colorAlerta = diferencia === 0 ? 'verde' : diffAbs <= limite ? 'amarillo' : 'rojo';
    notify({ tipo: 'corte_caja', color: colorAlerta, bartender: quien.nombre, ventasTotal: ventasEfectivo + ventasTransferencia,
      ventasEfectivo, ventasTransferencia, efectivoContado: Number(efectivoContado), diferencia, hora: cut.hora,
      productosAReponer: insumosAReponer.map((i) => i.nombre), atendido: false });
    log(quien.nombre, 'Cerró el corte de caja del día — diferencia: ' + money(diferencia));
    toast(diferencia === 0 ? '✅ Corte de caja cuadrado perfectamente' : diferencia > 0 ? '⚠️ Sobrante de ' + money(diferencia) : '⚠️ Faltante de ' + money(Math.abs(diferencia)));
    setEfectivoContado('');reiniciarContador();setNotaJustificacion('');
  }

  // Una vez confirmado el corte de hoy, el bartender solo puede CONSULTARLO — sin poder editar ni ver el historial completo.
  if (miCorteDeHoy) {
    return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
    React.createElement("h1", null, "Corte de caja"), /*#__PURE__*/
    React.createElement("div", { className: "card", style: { maxWidth: 480 } }, /*#__PURE__*/
    React.createElement("div", { className: 'tag ' + (miCorteDeHoy.diferencia === 0 ? 'ok' : Math.abs(miCorteDeHoy.diferencia) <= limite ? 'warn' : 'danger'), style: { fontSize: 14, padding: '6px 14px' } },
    miCorteDeHoy.diferencia === 0 ? '✅ Cuadrado perfectamente' : Math.abs(miCorteDeHoy.diferencia) <= limite ? '⚠️ Diferencia menor' : '🚨 Diferencia mayor a ' + money(limite)
    ), /*#__PURE__*/
    React.createElement("h3", { style: { marginTop: 14 } }, "Tu corte de hoy \u2014 ", miCorteDeHoy.hora), /*#__PURE__*/
    React.createElement("div", { className: "flexrow small", style: { marginBottom: 4 } }, /*#__PURE__*/React.createElement("span", null, "Efectivo esperado"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("strong", null, money(miCorteDeHoy.efectivoEsperado))), /*#__PURE__*/
    React.createElement("div", { className: "flexrow small", style: { marginBottom: 4 } }, /*#__PURE__*/React.createElement("span", null, "Efectivo contado"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("strong", null, money(miCorteDeHoy.efectivoContado))), /*#__PURE__*/
    React.createElement("div", { className: "flexrow small", style: { marginBottom: 10 } }, /*#__PURE__*/React.createElement("span", null, "Diferencia"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("strong", null, money(miCorteDeHoy.diferencia))),
    miCorteDeHoy.notaJustificacion && /*#__PURE__*/React.createElement("div", { className: "small", style: { marginBottom: 10 } }, "\uD83D\uDCDD Nota: ", miCorteDeHoy.notaJustificacion), /*#__PURE__*/
    React.createElement("p", { className: "small" }, "Este corte ya qued\xF3 confirmado y no se puede editar ni eliminar. Si hay un error, p\xEDdele al administrador que agregue una nota de correcci\xF3n."), /*#__PURE__*/
    React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => generarPDFCorteCaja(miCorteDeHoy) }, "\uD83D\uDCC4 Descargar PDF")
    )
    );
  }

  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Corte de caja"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Toma el fondo que te dej\xF3 el administrador, suma las ventas en efectivo del turno, resta lo que se haya gastado directamente del fondo, y compara contra lo que cuentes con el contador de billetes de la derecha."), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-2", style: { alignItems: 'start' } }, /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow small", style: { marginBottom: 6 } }, /*#__PURE__*/React.createElement("span", null, "Fondo inicial de hoy"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("strong", null, money(fondoInicial))), /*#__PURE__*/
  React.createElement("div", { className: "flexrow small", style: { marginBottom: 6 } }, /*#__PURE__*/React.createElement("span", null, "+ Ventas en efectivo (hoy)"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("strong", null, money(ventasEfectivo))), /*#__PURE__*/
  React.createElement("div", { className: "flexrow small", style: { marginBottom: 6 } }, /*#__PURE__*/React.createElement("span", null, "\u2212 Gastos tomados del fondo"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("strong", null, "-", money(gastoDelFondo))), /*#__PURE__*/
  React.createElement("hr", { className: "line" }), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { fontWeight: 800, marginBottom: 10 } }, /*#__PURE__*/React.createElement("span", null, "= Efectivo esperado en caja"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", null, money(efectivoEsperado))), /*#__PURE__*/
  React.createElement("div", { className: "small", style: { marginBottom: 6 } }, "Ventas por transferencia (hoy, informativo, no van en la caja f\xEDsica): ", money(ventasTransferencia + ticketsTransferConfirmados)),
  descuentosCuponHoy > 0 && /*#__PURE__*/React.createElement("div", { className: "small", style: { marginBottom: 10 } }, "\uD83C\uDFF7\uFE0F Descuentos por cup\xF3n familiar aplicados hoy (ya restados de las ventas de arriba): ", /*#__PURE__*/React.createElement("strong", null, money(descuentosCuponHoy))), /*#__PURE__*/
  React.createElement(Field, { label: "Efectivo contado f\xEDsicamente en caja" }, /*#__PURE__*/React.createElement("input", { type: "number", value: efectivoContado, onChange: (e) => setEfectivoContado(e.target.value) })),
  diferencia !== null && /*#__PURE__*/React.createElement("div", { className: 'alert ' + (diferencia === 0 ? '' : requiereJustificacion ? 'danger' : ''), style: { marginTop: 10 } },
  diferencia === 0 ? '✅ El corte cuadra exactamente.' : requiereJustificacion ? '🚨 Diferencia mayor a ' + money(limite) + ' detectada — revisa tu conteo antes de confirmar.' : diferencia > 0 ? '⚠️ Hay un sobrante de ' + money(diferencia) + '.' : '⚠️ Hay un faltante de ' + money(Math.abs(diferencia)) + '.'
  ),
  requiereJustificacion && /*#__PURE__*/React.createElement(Field, { label: "Nota obligatoria explicando la diferencia" }, /*#__PURE__*/
  React.createElement("textarea", { rows: 3, value: notaJustificacion, onChange: (e) => setNotaJustificacion(e.target.value), placeholder: "Ej. falt\xF3 contar una propina en efectivo, error al dar cambio, etc." })
  ), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", style: { marginTop: 12 }, disabled: requiereJustificacion && !notaJustificacion.trim(), onClick: cerrarTurno }, "Cerrar corte de caja del d\xEDa")
  ), /*#__PURE__*/

  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "\uD83E\uDDEE Contador de efectivo"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "En vez de contar el dinero mentalmente, ve agregando cu\xE1ntos billetes y monedas tienes de cada denominaci\xF3n (incluye monedas de $10 y $5)."),
  DENOMINACIONES.map((d) => /*#__PURE__*/React.createElement("div", { key: d, className: "flexrow", style: { marginBottom: 8 } }, /*#__PURE__*/
  React.createElement("span", { style: { width: 70, fontWeight: 700 } }, "$", d), /*#__PURE__*/
  React.createElement("input", { type: "number", min: "0", value: conteo[d], onChange: (e) => cambiarConteo(d, e.target.value), style: { maxWidth: 90 } }), /*#__PURE__*/
  React.createElement("span", { className: "small", style: { width: 32, textAlign: 'center' } }, "\xD7"), /*#__PURE__*/
  React.createElement("span", { className: "small", style: { flex: 1 } }, "= ", money(d * (Number(conteo[d]) || 0)))
  )), /*#__PURE__*/
  React.createElement("hr", { className: "line" }), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { fontWeight: 800, fontSize: 18, marginBottom: 12 } }, /*#__PURE__*/React.createElement("span", null, "Total contado"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", null, money(totalContador))), /*#__PURE__*/
  React.createElement("div", { className: "flexrow" }, /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary btn-sm", onClick: vaciarAlCorte }, "\uD83D\uDCE5 Vaciar al corte de caja"), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: reiniciarContador }, "Reiniciar contador")
  )
  )
  )
  );
}

// Cubetazo: 10 cervezas cobradas siempre como paquete ($150), sin importar cuántas se hayan
// ido marcando individualmente conforme el bartender las entrega. El mesero ve el conteo en vivo.
const CUBETAZO_TOTAL = 10;
const CUBETAZO_PRECIO = 150;
const CUBETAZO_PRECIO_INDIVIDUAL = 20; // referencia: Tecate azul
// Pantalla del Bartender para buscar el folio del evento y descontar fichas conforme sirve bebidas.
// Cierre de turno del Bartender: checklist de insumos/productos con mínimos requeridos.
function BarCierreTurno() {
  const { state, pushTo, toast, log } = useStore();
  const [conteo, setConteo] = useState(() => Object.fromEntries(CHECKLIST_INSUMOS_SEED.map((it) => [it.id, ''])));
  function cambiar(id, val) {setConteo((c) => ({ ...c, [id]: val }));}
  const filas = CHECKLIST_INSUMOS_SEED.map((it) => {
    const cantidad = Number(conteo[it.id]) || 0;
    const faltante = Math.max(0, it.minimo - cantidad);
    return { ...it, cantidad, faltante, bajoMinimo: conteo[it.id] !== '' && cantidad < it.minimo };
  });
  const itemsAReponer = filas.filter((f) => f.bajoMinimo);
  const bartender = state.staff.find((s) => s.id === state.staffSession);

  function guardarCierre() {
    if (CHECKLIST_INSUMOS_SEED.some((it) => conteo[it.id] === '')) {toast('Completa la cantidad de todos los productos antes de guardar');return;}
    const reporte = {
      id: uid('shf'), fecha: todayISO(), hora: nowTime(), bartender: bartender ? bartender.nombre : 'Cantinero',
      items: filas.map((f) => ({ nombre: f.nombre, cantidad: f.cantidad, minimo: f.minimo, faltante: f.faltante, necesitaReposicion: f.bajoMinimo })),
      estado: itemsAReponer.length > 0 ? 'pendiente' : 'sin_pendientes'
    };
    pushTo('shiftCloseReports', reporte);
    log('Cantinero', 'Cerró turno con checklist de insumos (' + itemsAReponer.length + ' productos por reponer)');
    toast(itemsAReponer.length > 0 ? '📋 Cierre guardado — reporte de reposición enviado al administrador (' + itemsAReponer.length + ' productos)' : '✅ Cierre guardado — todo está en niveles normales');
    setConteo(Object.fromEntries(CHECKLIST_INSUMOS_SEED.map((it) => [it.id, ''])));
  }

  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Cierre de turno"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Marca cu\xE1ntas unidades quedan de cada producto al final de tu turno. Lo que est\xE9 por debajo del m\xEDnimo se resalta en rojo y se env\xEDa autom\xE1ticamente al administrador como reporte de reposici\xF3n."), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("table", null, /*#__PURE__*/
  React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Producto"), /*#__PURE__*/React.createElement("th", null, "M\xEDnimo requerido"), /*#__PURE__*/React.createElement("th", null, "Unidades restantes"), /*#__PURE__*/React.createElement("th", null, "Estado"))), /*#__PURE__*/
  React.createElement("tbody", null, filas.map((f) => /*#__PURE__*/React.createElement("tr", { key: f.id, style: f.bajoMinimo ? { background: 'rgba(255,90,90,.08)' } : {} }, /*#__PURE__*/
  React.createElement("td", null, f.nombre), /*#__PURE__*/
  React.createElement("td", null, f.minimo), /*#__PURE__*/
  React.createElement("td", null, /*#__PURE__*/React.createElement("input", { type: "number", min: "0", style: { maxWidth: 90 }, value: conteo[f.id], onChange: (e) => cambiar(f.id, e.target.value) })), /*#__PURE__*/
  React.createElement("td", null, conteo[f.id] === '' ? /*#__PURE__*/React.createElement("span", { className: "small" }, "\u2014") : f.bajoMinimo ? /*#__PURE__*/React.createElement("span", { className: "tag danger" }, "\uD83D\uDD34 Reponer (", f.faltante, " faltan)") : /*#__PURE__*/React.createElement("span", { className: "tag ok" }, "\u2705 OK"))
  )))
  )
  ),
  itemsAReponer.length > 0 && /*#__PURE__*/React.createElement("div", { className: "alert danger", style: { marginTop: 14 } }, "\u26A0\uFE0F ", itemsAReponer.length, " producto(s) est\xE1n por debajo del m\xEDnimo y se incluir\xE1n en el reporte de reposici\xF3n."), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", style: { marginTop: 14 }, onClick: guardarCierre }, "Guardar cierre de turno"), /*#__PURE__*/

  React.createElement("div", { className: "card", style: { marginTop: 20 } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Mis cierres anteriores"), /*#__PURE__*/
  React.createElement(DataTable, { emptyText: "Sin cierres registrados.", columns: [
    { key: 'fecha', label: 'Fecha' }, { key: 'hora', label: 'Hora' },
    { key: 'pendientes', label: 'Productos a reponer', render: (r) => r.items.filter((i) => i.necesitaReposicion).length },
    { key: 'estado', label: 'Estado', render: (r) => /*#__PURE__*/React.createElement("span", { className: 'tag ' + (r.estado === 'aprobado' ? 'ok' : r.estado === 'sin_pendientes' ? 'ok' : 'warn') }, r.estado === 'aprobado' ? 'Aprobado por admin' : r.estado === 'sin_pendientes' ? 'Sin pendientes' : 'Pendiente de revisión') }],
    rows: [...state.shiftCloseReports].reverse() })
  )
  );
}
function BarCubetazos() {
  const { state, pushTo, updateItem, pushTo: push2, toast, log } = useStore();
  const mesasOcupadas = state.tables.filter((t) => t.estado === 'ocupada');
  const cubetazosAbiertos = state.cubetazos.filter((c) => c.estado === 'abierto');

  function nuevoCubetazo(mesa) {
    if (cubetazosAbiertos.some((c) => c.mesaId === mesa.id)) {toast('Ya hay un cubetazo abierto en esa mesa');return;}
    pushTo('cubetazos', { id: uid('cub'), mesaId: mesa.id, mesaNumero: mesa.numero, mesero: mesa.ocupadaPorNombre || '—', entregadas: 0, total: CUBETAZO_TOTAL, precio: CUBETAZO_PRECIO, estado: 'abierto', fecha: todayISO(), hora: nowTime() });
    toast('🪣 Nuevo cubetazo abierto para la Mesa ' + mesa.numero);
  }
  function entregarCerveza(cub) {
    if (cub.entregadas >= cub.total) {toast('Ya se entregaron las 10 cervezas de este cubetazo');return;}
    updateItem('cubetazos', cub.id, { entregadas: cub.entregadas + 1 });
  }
  function cerrarCubetazo(cub) {
    pushTo('sales', { id: uid('sale'), fecha: todayISO(), hora: nowTime(), mesero: cub.mesero, pago: 'efectivo',
      producto: 'Cubetazo', categoria: 'Cervezas individuales', variante: 'Único', sabor: null, cerveza: null,
      cantidad: 1, precioUnit: CUBETAZO_PRECIO, total: CUBETAZO_PRECIO, descuento: 0, cambio: 0, entrega: 'establecimiento',
      estadoPedido: 'Entregado' });
    updateItem('cubetazos', cub.id, { estado: 'cerrado' });
    log('Cantinero', 'Cerró y cobró cubetazo de Mesa ' + cub.mesaNumero + ' — ' + money(CUBETAZO_PRECIO));
    toast('✅ Cubetazo de la Mesa ' + cub.mesaNumero + ' cobrado a ' + money(CUBETAZO_PRECIO) + ' (paquete completo)');
  }

  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Cubetazos"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Abre un cubetazo por mesa y ve marcando cada cerveza conforme la entregas. El mesero ve el conteo en vivo sin tener que preguntarte. El cobro final siempre es ", /*#__PURE__*/React.createElement("strong", null, money(CUBETAZO_PRECIO)), " por el paquete completo, sin importar cu\xE1ntas cervezas se hayan ido marcando \u2014 nunca se cobra por cerveza suelta."), /*#__PURE__*/

  React.createElement("div", { className: "card", style: { marginBottom: 16 } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Abrir nuevo cubetazo"),
  mesasOcupadas.length === 0 && /*#__PURE__*/React.createElement("p", { className: "small" }, "No hay mesas ocupadas en este momento."), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { flexWrap: 'wrap' } },
  mesasOcupadas.map((m) => /*#__PURE__*/React.createElement("button", { key: m.id, className: "btn btn-secondary btn-sm", disabled: cubetazosAbiertos.some((c) => c.mesaId === m.id), onClick: () => nuevoCubetazo(m) }, "\uD83E\uDEA3 Mesa ", m.numero, " (", m.ocupadaPorNombre || '—', ")"))
  )
  ), /*#__PURE__*/

  React.createElement("div", { className: "grid grid-2" },
  cubetazosAbiertos.map((cub) => {
    const precioIndividual = CUBETAZO_PRECIO_INDIVIDUAL * CUBETAZO_TOTAL;
    const ahorro = precioIndividual - CUBETAZO_PRECIO;
    return /*#__PURE__*/React.createElement("div", { key: cub.id, className: "card" }, /*#__PURE__*/
    React.createElement("div", { className: "flexrow" }, /*#__PURE__*/React.createElement("strong", null, "Mesa ", cub.mesaNumero), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", { className: "small" }, "Mesero: ", cub.mesero)), /*#__PURE__*/
    React.createElement("div", { style: { margin: '10px 0' } }, /*#__PURE__*/
    React.createElement("div", { className: "small", style: { marginBottom: 4 } }, cub.entregadas, " / ", cub.total, " cervezas entregadas"), /*#__PURE__*/
    React.createElement("div", { style: { height: 10, background: 'var(--bg-soft)', borderRadius: 6, overflow: 'hidden' } }, /*#__PURE__*/
    React.createElement("div", { style: { height: '100%', width: cub.entregadas / cub.total * 100 + '%', background: 'var(--ok)', transition: 'width .2s' } })
    )
    ), /*#__PURE__*/
    React.createElement("button", { className: "btn btn-primary btn-sm", disabled: cub.entregadas >= cub.total, onClick: () => entregarCerveza(cub) }, "\uD83C\uDF7A Entregar cerveza"), /*#__PURE__*/
    React.createElement("div", { className: "card", style: { marginTop: 10, background: 'var(--bg-soft)' } }, /*#__PURE__*/
    React.createElement("div", { className: "flexrow small" }, /*#__PURE__*/React.createElement("span", null, "Si se compraran sueltas (10 \xD7 ", money(CUBETAZO_PRECIO_INDIVIDUAL), ")"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", { style: { textDecoration: 'line-through', opacity: .6 } }, money(precioIndividual))), /*#__PURE__*/
    React.createElement("div", { className: "flexrow", style: { fontWeight: 800, fontSize: 16 } }, /*#__PURE__*/React.createElement("span", null, "Precio del cubetazo"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", { style: { color: 'var(--ok)' } }, money(CUBETAZO_PRECIO))), /*#__PURE__*/
    React.createElement("div", { className: "small" }, "Ahorra ", money(ahorro), " comprando el paquete")
    ), /*#__PURE__*/
    React.createElement("button", { className: "btn btn-secondary btn-sm", style: { marginTop: 8, width: '100%' }, onClick: () => cerrarCubetazo(cub) }, "Cerrar y cobrar cubetazo \u2014 ", money(CUBETAZO_PRECIO))
    );
  })
  ),
  cubetazosAbiertos.length === 0 && /*#__PURE__*/React.createElement("p", { className: "small", style: { marginTop: 14 } }, "No hay cubetazos abiertos ahora mismo.")
  );
}
// Vista de solo lectura para el Mesero: ve el conteo de cubetazos abiertos de sus propias mesas.
function MeseroCubetazos({ mesero }) {
  const { state } = useStore();
  const misCubetazos = state.cubetazos.filter((c) => c.mesero === mesero.nombre);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Cubetazos de mis mesas"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "El bartender va marcando cada cerveza conforme la entrega \u2014 aqu\xED ves el avance en vivo, sin tener que ir a preguntar. Sin importar cu\xE1ntas se hayan marcado, el cobro final es siempre ", money(CUBETAZO_PRECIO), " por el paquete completo."),
  misCubetazos.length === 0 && /*#__PURE__*/React.createElement("p", { className: "small" }, "No tienes cubetazos registrados."), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-2" },
  misCubetazos.map((cub) => /*#__PURE__*/React.createElement("div", { key: cub.id, className: "card" }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow" }, /*#__PURE__*/React.createElement("strong", null, "Mesa ", cub.mesaNumero), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", { className: 'tag ' + (cub.estado === 'abierto' ? 'warn' : 'ok') }, cub.estado === 'abierto' ? 'En curso' : 'Cobrado')), /*#__PURE__*/
  React.createElement("div", { style: { margin: '10px 0' } }, /*#__PURE__*/
  React.createElement("div", { className: "small", style: { marginBottom: 4 } }, cub.entregadas, " / ", cub.total, " cervezas entregadas"), /*#__PURE__*/
  React.createElement("div", { style: { height: 10, background: 'var(--bg-soft)', borderRadius: 6, overflow: 'hidden' } }, /*#__PURE__*/
  React.createElement("div", { style: { height: '100%', width: cub.entregadas / cub.total * 100 + '%', background: 'var(--ok)' } })
  )
  ), /*#__PURE__*/
  React.createElement("div", { style: { fontWeight: 800 } }, "Precio: ", money(cub.precio), " (paquete completo)")
  ))
  )
  );
}
function InsumosPanel({ area }) {
  const { state, updateItem, pushTo, toast } = useStore();
  const rows = state.insumos.filter((i) => i.area === area);
  const [editando, setEditando] = useState(null);
  const [agregando, setAgregando] = useState(false);
  const [nombre, setNombre] = useState('');const [stock, setStock] = useState('');const [minimo, setMinimo] = useState('');
  function guardarNuevo() {
    if (!nombre.trim()) {toast('Escribe el nombre del insumo');return;}
    pushTo('insumos', { id: uid('ins'), area, nombre: nombre.trim(), stock: Number(stock) || 0, minimo: Number(minimo) || 0 });
    toast('✅ Insumo agregado a ' + (area === 'cantinero' ? 'la barra' : 'la cocina'));
    setNombre('');setStock('');setMinimo('');setAgregando(false);
  }
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, "Insumos de ", area === 'cantinero' ? 'barra' : 'cocina'), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { marginBottom: 10 } }, /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary btn-sm", onClick: () => setAgregando(true) }, "+ Agregar insumo")
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement(DataTable, { emptyText: "A\xFAn no hay insumos registrados.", columns: [
    { key: 'nombre', label: 'Insumo' }, { key: 'stock', label: 'Stock', render: (r) => /*#__PURE__*/React.createElement("span", { className: r.stock < r.minimo ? 'tag danger' : 'tag ok' }, r.stock) }, { key: 'minimo', label: 'Mínimo' }],
    rows: rows, onView: (r) => setEditando(r) })
  ),
  editando && /*#__PURE__*/React.createElement(EditarCampoModal, { titulo: 'Actualizar stock de ' + editando.nombre, valorInicial: editando.stock, tipo: "number",
    onClose: () => setEditando(null),
    onGuardar: (val) => {updateItem('insumos', editando.id, { stock: Number(val) });toast('Stock actualizado');} }),
  agregando && /*#__PURE__*/React.createElement(Modal, { title: 'Agregar insumo a ' + (area === 'cantinero' ? 'la barra' : 'la cocina'), onClose: () => setAgregando(false) }, /*#__PURE__*/
  React.createElement("div", { className: "grid", style: { gap: 12 } }, /*#__PURE__*/
  React.createElement(Field, { label: "Nombre del insumo" }, /*#__PURE__*/React.createElement("input", { autoFocus: true, value: nombre, onChange: (e) => setNombre(e.target.value) })), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-2" }, /*#__PURE__*/
  React.createElement(Field, { label: "Stock inicial" }, /*#__PURE__*/React.createElement("input", { type: "number", value: stock, onChange: (e) => setStock(e.target.value) })), /*#__PURE__*/
  React.createElement(Field, { label: "Stock m\xEDnimo (para alertas)" }, /*#__PURE__*/React.createElement("input", { type: "number", value: minimo, onChange: (e) => setMinimo(e.target.value) }))
  ), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", onClick: guardarNuevo }, "\u2705 Guardar insumo")
  )
  )
  );
}
function ReportarFaltante({ rol }) {
  const { state, notify, toast } = useStore();
  const [insumo, setInsumo] = useState('');const [detalle, setDetalle] = useState('');
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, "Reportar faltante"), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { maxWidth: 420 } }, /*#__PURE__*/
  React.createElement(Field, { label: "Insumo" }, /*#__PURE__*/React.createElement("input", { value: insumo, onChange: (e) => setInsumo(e.target.value) })), /*#__PURE__*/
  React.createElement(Field, { label: "Detalle (opcional)" }, /*#__PURE__*/React.createElement("input", { value: detalle, onChange: (e) => setDetalle(e.target.value) })), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", style: { marginTop: 10 }, onClick: () => {if (!insumo) return;notify({ tipo: 'faltante', insumo, detalle, reportadoPor: rol });toast('📣 Faltante reportado al administrador');setInsumo('');setDetalle('');} }, "Reportar")
  )
  );
}
function ImagenesProducto() {
  const { state, pushTo, log, toast } = useStore();
  const [catId, setCatId] = useState(state.catalog[0].id);
  function upload(e) {
    const f = e.target.files[0];if (!f) return;
    const url = URL.createObjectURL(f);
    pushTo('productImages', { id: uid('img'), catId, url, name: f.name, fecha: todayISO() });
    log('Cantinero', 'Subió imagen de producto para ' + catId);
    toast('📷 Imagen subida — visible al instante en Admin, Cliente, Cocina y Mesero');
  }
  const imgs = state.productImages;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Subir im\xE1genes de producto"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Solo im\xE1genes de cat\xE1logo (no banners de campa\xF1a \u2014 eso es exclusivo del Administrador). Se reflejan al instante en Administrador, Cliente, Cocina y Mesero."), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { maxWidth: 480 } }, /*#__PURE__*/
  React.createElement(Field, { label: "Categor\xEDa" }, /*#__PURE__*/React.createElement("select", { value: catId, onChange: (e) => setCatId(e.target.value) }, state.catalog.map((c) => /*#__PURE__*/React.createElement("option", { key: c.id, value: c.id }, c.nombre)))), /*#__PURE__*/
  React.createElement("input", { type: "file", accept: "image/*", onChange: upload, style: { marginTop: 10 } })
  ), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-4", style: { marginTop: 14 } },
  imgs.map((im) => /*#__PURE__*/React.createElement("div", { key: im.id, className: "card" }, /*#__PURE__*/React.createElement("img", { src: im.url, style: { width: '100%', borderRadius: 8 } }), /*#__PURE__*/React.createElement("div", { className: "small" }, im.name, " \u2014 ", state.catalog.find((c) => c.id === im.catId)?.nombre)))
  )
  );
}
// Última imagen subida para una categoría (o null); usada por Cliente/Admin/Cocina/Mesero.
function imagenParaCategoria(state, catId) {
  const imgs = state.productImages.filter((i) => i.catId === catId);
  return imgs.length ? imgs[imgs.length - 1].url : null;
}
function GaleriaImagenesProducto({ titulo = 'Imágenes de producto (subidas por el Cantinero)' }) {
  const { state } = useStore();
  return /*#__PURE__*/React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, titulo),
  state.productImages.length === 0 && /*#__PURE__*/React.createElement("p", { className: "small" }, "A\xFAn no hay im\xE1genes subidas."), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-4" },
  state.productImages.map((im) => /*#__PURE__*/React.createElement("div", { key: im.id }, /*#__PURE__*/React.createElement("img", { src: im.url, style: { width: '100%', borderRadius: 8 } }), /*#__PURE__*/React.createElement("div", { className: "small" }, state.catalog.find((c) => c.id === im.catId)?.nombre)))
  )
  );
}
function CatalogoLectura() {
  const { state } = useStore();
  return /*#__PURE__*/React.createElement("div", { style: { maxHeight: 280, overflowY: 'auto' } },
  state.catalog.map((c) => /*#__PURE__*/React.createElement("div", { key: c.id, style: { marginBottom: 8 } }, /*#__PURE__*/
  React.createElement("strong", null, c.nombre),
  c.productos.map((p) => /*#__PURE__*/React.createElement("div", { key: p.id, className: "small" }, p.nombre, " \u2014 ", p.variantes.map((v) => money(v.precio)).join(' / '), " ", p.agotado && /*#__PURE__*/React.createElement("span", { className: "tag danger", style: { marginLeft: 6 } }, "\uD83D\uDD34 Agotado")))
  ))
  );
}
function CuentaGenerica({ rol }) {
  const { state, updateItem, toast } = useStore();
  const persona = state.staff.find((s) => s.id === state.staffSession) || state.staff.find((s) => s.rol === rol) || {};
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, "Mi perfil"),
  rol === 'cocinera' && /*#__PURE__*/React.createElement(EstadoCocinaCard, null),
  rol === 'bartender' && /*#__PURE__*/React.createElement(BotonAperturaNegocio, { quien: "Cantinero", compacto: true }), /*#__PURE__*/
  React.createElement(PerfilCard, { persona: persona, onGuardar: (patch) => {updateItem('staff', persona.id, patch);toast('✅ Perfil actualizado');} }), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { maxWidth: 420, marginTop: 14 } }, /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Horario: ", persona.entrada || '—', " \u2013 ", persona.salida || '—'), /*#__PURE__*/
  React.createElement(ThemeToggle, null)
  )
  );
}

/* ============================= COCINA ============================= */
const KITCHEN_SECTIONS = [
{ label: 'Principal', items: [{ key: 'dashboard', label: 'Menú Principal', icon: '📊' }, { key: 'comandas', label: 'Pedidos en preparación', icon: '🍗' }, { key: 'tiempos', label: 'Tiempos de preparación', icon: '⏱️' }] },
{ label: 'Inventario', items: [{ key: 'sabores', label: 'Control de sabores', icon: '🍧' }, { key: 'insumos', label: 'Insumos de cocina', icon: '🥔' }, { key: 'faltante', label: 'Reportar faltante', icon: '📣' }] },
{ label: 'Asistencia', items: [{ key: 'asistencia', label: 'Avisar retraso/falta', icon: '⏰' }] },
{ label: 'Cuenta', items: [{ key: 'cuenta', label: 'Mi perfil', icon: '⚙️' }] }];

function CocinaView() {
  const [section, setSection] = useState('dashboard');
  const { state } = useStore();
  const insumosAlerta = state.insumos.filter((i) => i.area === 'cocina' && i.stock < i.minimo).length;
  const MAP = {
    dashboard: /*#__PURE__*/React.createElement(CocinaDashboard, { goto: setSection }), comandas: /*#__PURE__*/React.createElement(CocinaComandas, null),
    tiempos: /*#__PURE__*/React.createElement(CocinaTiemposPreparacion, null),
    sabores: /*#__PURE__*/React.createElement(ControlDeSabores, { rol: "Cocinera", categoriasSabores: ['alitas'] }),
    insumos: /*#__PURE__*/React.createElement(InsumosPanel, { area: "cocina" }), faltante: /*#__PURE__*/React.createElement(ReportarFaltante, { rol: "Cocinera" }),
    asistencia: /*#__PURE__*/React.createElement(AvisarAsistencia, { rol: "cocinera" }), cuenta: /*#__PURE__*/React.createElement(CuentaGenerica, { rol: "cocinera" })
  };
  return /*#__PURE__*/React.createElement(PanelLayout, { sections: KITCHEN_SECTIONS, section: section, setSection: setSection, badges: { insumos: insumosAlerta } }, MAP[section]);
}
// Panel de la Cocinera para definir/ajustar en cualquier momento el tiempo estimado (en minutos) de cada platillo.
function CocinaTiemposPreparacion() {
  const { state, setState, log, toast } = useStore();
  const cfg = state.tiemposPreparacion || {};
  const alitasCat = state.catalog.find((c) => c.id === 'alitas');
  const snacksCat = state.catalog.find((c) => c.id === 'snacks' || c.nombre === 'Snacks y botanas');
  const platillosAlitas = alitasCat ? ['Alitas 8 piezas', 'Alitas 10 piezas', 'Alitas 12 piezas'] : [];
  const platillosSnacks = snacksCat ? snacksCat.productos.map((p) => p.nombre) : [];

  function guardar(clave, valor) {
    const minutos = Math.max(1, Number(valor) || 1);
    setState((s) => ({ ...s, tiemposPreparacion: { ...(s.tiemposPreparacion || {}), [clave]: minutos } }));
    log('Cocinera', 'Actualizó el tiempo de preparación de "' + clave + '" a ' + minutos + ' min');
    toast('⏱️ "' + clave + '" ahora tarda ' + minutos + ' min');
  }

  function Fila({ clave }) {
    const [valor, setValor] = useState(cfg[clave] != null ? cfg[clave] : 20);
    return /*#__PURE__*/React.createElement("div", { className: "flexrow", style: { marginBottom: 10, gap: 10, flexWrap: 'wrap' } }, /*#__PURE__*/
    React.createElement("span", { style: { flex: 1, minWidth: 180 } }, clave), /*#__PURE__*/
    React.createElement("input", { type: "number", min: "1", style: { width: 90 }, value: valor, onChange: (e) => setValor(e.target.value) }), /*#__PURE__*/
    React.createElement("span", { className: "small" }, "min"), /*#__PURE__*/
    React.createElement("button", { className: "btn btn-primary btn-sm", onClick: () => guardar(clave, valor) }, "Guardar")
    );
  }

  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "\u23F1\uFE0F Tiempos de preparaci\xF3n"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Define cu\xE1nto tarda cada platillo \u2014 t\xFA decides seg\xFAn tu ritmo real de trabajo, y lo puedes ajustar cuando quieras (por ejemplo, subirlo si hay mucha demanda) para que el cliente, el mesero y el bartender vean una expectativa realista. Estos tiempos base se van sumando autom\xE1ticamente seg\xFAn cu\xE1ntas \xF3rdenes tengas por delante en la fila. Si un pedido en particular va a tardar distinto a lo calculado (porque t\xFA ya sabes c\xF3mo va tu carga de trabajo ese d\xEDa), puedes ponerle un tiempo a mano directamente desde \"Pedidos en preparaci\xF3n\", con el bot\xF3n \"\u23F1\uFE0F Poner tiempo real de este pedido\" \u2014 ese valor manda sobre el c\xE1lculo autom\xE1tico solo para esa comanda."), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginBottom: 14 } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "\uD83C\uDF57 Alitas"),
  platillosAlitas.map((clave) => /*#__PURE__*/React.createElement(Fila, { key: clave, clave: clave }))
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "\uD83C\uDF5F Botanas y snacks"),
  platillosSnacks.map((clave) => /*#__PURE__*/React.createElement(Fila, { key: clave, clave: clave })),
  platillosSnacks.length === 0 && /*#__PURE__*/React.createElement("p", { className: "small" }, "No hay productos en esta categor\xEDa todav\xEDa.")
  )
  );
}
// Aviso para la Cocinera: se muestra 15 minutos antes del cierre de cocina, y de forma permanente si ya cerró.
function AvisoCierreCocina() {
  const { state } = useStore();
  const [, setTick] = useState(0);
  useEffect(() => {const t = setInterval(() => setTick((x) => x + 1), 20000);return () => clearInterval(t);}, []);
  const hc = state.horariosCierre;
  if (!hc || !hc.activo) return null;
  const restantes = minutosParaCierreCocina(hc);
  if (restantes === null) return null;
  if (restantes <= 0) {
    return /*#__PURE__*/React.createElement("div", { className: "alert danger", style: { marginBottom: 16 } }, "\uD83D\uDD34 La cocina ya cerr\xF3 por hoy (horario especial de cierre: ", hc.cierreCocina, "). No se aceptan m\xE1s comandas de comida.");
  }
  if (restantes <= 15) {
    return /*#__PURE__*/React.createElement("div", { className: "alert", style: { marginBottom: 16 } }, "\u23F0 ", /*#__PURE__*/React.createElement("strong", null, "La cocina cierra en ", restantes, " min"), " (a las ", hc.cierreCocina, ") \u2014 horario especial de cierre activo. Prep\xE1rate para el corte.");
  }
  return null;
}
// Aviso previo (Forma 1, automático): 15 minutos antes del cierre automático diario de la cocina.
function AvisoCierreCocinaAuto() {
  const { state } = useStore();
  const [, setTick] = useState(0);
  useEffect(() => {const t = setInterval(() => setTick((x) => x + 1), 20000);return () => clearInterval(t);}, []);
  const info = cocinaEstadoInfo(state);
  if (!info.abierta || !info.automatico) return null; // ya cerrada, o el estado actual es por override manual: no aplica el aviso automático
  const restantes = minutosParaCierreCocinaAuto(state);
  if (restantes === null || restantes > 15 || restantes < 0) return null;
  return /*#__PURE__*/React.createElement("div", { className: "alert", style: { marginBottom: 16 } }, "\u23F0 ", /*#__PURE__*/React.createElement("strong", null, "La cocina cierra en ", restantes, " min"), " (a las ", horaTexto12(cocinaHorarioActual(state).horaCierreAuto), ") \u2014 prepara los \xFAltimos pedidos.");
}
// Tarjeta grande para la Cocinera: estado actual (abierta/cerrada + hora) y botón para abrir/cerrar manualmente (Forma 2).
function EstadoCocinaCard() {
  const { state, setState, notify, log, toast } = useStore();
  const [confirmando, setConfirmando] = useState(false);
  const info = cocinaEstadoInfo(state);

  function ejecutarCambio() {
    const nuevoEstado = info.abierta ? 'cerrada' : 'abierta';
    setState({ cocinaManual: { estado: nuevoEstado, fecha: todayISO(), hora: nowTime(), por: 'Cocinera' } });
    log('Cocinera', (nuevoEstado === 'abierta' ? 'Abrió' : 'Cerró') + ' la cocina manualmente');
    notify({ tipo: 'cocina_estado', estado: nuevoEstado, automatico: false, por: 'Cocinera' });
    toast(nuevoEstado === 'abierta' ? '🟢 Cocina abierta' : '🔴 Cocina cerrada por hoy');
    setConfirmando(false);
  }

  return /*#__PURE__*/React.createElement("div", { className: "card", style: { marginBottom: 16, textAlign: 'center' } }, /*#__PURE__*/
  React.createElement("div", { className: 'tag ' + (info.abierta ? 'ok' : 'danger'), style: { fontSize: 14, padding: '6px 14px' } },
  info.abierta ? '🟢 Cocina abierta' : '🔴 Cocina cerrada', " desde las ", horaTexto12(info.hora)
  ), /*#__PURE__*/
  React.createElement("div", { className: "small", style: { marginTop: 6 } }, info.automatico ? 'Horario automático' : 'Cierre/apertura manual por ' + info.por),
  !confirmando ? /*#__PURE__*/
  React.createElement("button", { className: 'btn ' + (info.abierta ? 'btn-secondary' : 'btn-primary'), style: { marginTop: 14 }, onClick: () => setConfirmando(true) },
  info.abierta ? '🔴 Cerrar cocina por hoy' : '🟢 Abrir cocina'
  ) : /*#__PURE__*/
  React.createElement("div", { style: { marginTop: 14 } }, /*#__PURE__*/
  React.createElement("p", { className: "small" }, info.abierta ? '¿Confirmas cerrar la cocina por hoy? Los clientes y el mesero verán que no se aceptan más pedidos de comida.' : '¿Confirmas abrir la cocina ahora?'), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { justifyContent: 'center', gap: 10 } }, /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary btn-sm", onClick: ejecutarCambio }, "S\xED, confirmar"), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => setConfirmando(false) }, "Cancelar")
  )
  )
  );
}
function CocinaDashboard({ goto }) {
  const { state } = useStore();
  const cola = comandasEnCola(state);
  const insumosAlerta = state.insumos.filter((i) => i.area === 'cocina' && i.stock < i.minimo);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Panel de Cocina"), /*#__PURE__*/
  React.createElement(AvisoCierreCocinaAuto, null), /*#__PURE__*/
  React.createElement(AvisoCierreCocina, null), /*#__PURE__*/
  React.createElement("div", { className: "alert", style: { marginBottom: 16 } }, "\u23F1\uFE0F ", /*#__PURE__*/
  React.createElement("div", null, /*#__PURE__*/React.createElement("strong", null, "Tiempos de preparaci\xF3n de referencia:"), " Alitas 30\u201335 min \xB7 Botana de carnes fr\xEDas 20\u201330 min \xB7 Papas a la francesa / Salchipapas / Papas gajo 15\u201325 min. Avisa siempre al mesero, al bartender y al cliente cu\xE1nto van a tardar."
  )
  ), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-2", style: { marginBottom: 16 } }, /*#__PURE__*/
  React.createElement(KpiCard, { label: "Comandas en fila", icon: "\uD83C\uDF57", value: cola.length }), /*#__PURE__*/
  React.createElement(KpiCard, { label: "Insumos en alerta", icon: "\u26A0\uFE0F", value: insumosAlerta.length })
  ), /*#__PURE__*/
  React.createElement("div", { className: "qa-grid", style: { marginBottom: 16 } }, /*#__PURE__*/
  React.createElement(QuickAction, { icon: "\uD83C\uDF73", label: "Ver comandas", onClick: () => goto('comandas') }), /*#__PURE__*/
  React.createElement(QuickAction, { icon: "\uD83D\uDCE3", label: "Reportar faltante", onClick: () => goto('faltante') }), /*#__PURE__*/
  React.createElement(QuickAction, { icon: "\u23F0", label: "Avisar retraso", onClick: () => goto('asistencia') })
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/React.createElement("h3", { style: { marginTop: 0 } }, "Pr\xF3ximas en fila (orden de llegada)"), /*#__PURE__*/
  React.createElement(DataTable, { emptyText: "Sin comandas en fila.", columns: [
    { key: 'turno', label: '#', render: (r) => '#' + (cola.findIndex((c) => c.id === r.id) + 1) },
    { key: 'hora', label: 'Hora' }, { key: 'producto', label: 'Producto' }, { key: 'cantidad', label: 'Cant.' },
    { key: 'mesero', label: 'Mesero', render: (r) => infoMeseroCliente(r).mesero },
    { key: 'cliente', label: 'Cliente', render: (r) => infoMeseroCliente(r).cliente },
    { key: 'estadoPedido', label: 'Estado', render: (r) => /*#__PURE__*/React.createElement("span", { className: 'tag ' + (r.estadoPedido === 'En preparación' ? 'warn' : 'info') }, r.estadoPedido || 'Pedido recibido') }],
    rows: cola })
  ), /*#__PURE__*/
  React.createElement("div", { style: { marginTop: 14 } }, /*#__PURE__*/React.createElement(GaleriaImagenesProducto, null))
  );
}
// Permite a la Cocinera poner (o ajustar) a mano cuánto va a tardar ESTE pedido en específico — porque solo ella
// sabe realmente cuántas comandas tiene por delante ese día y no siempre alcanza con el tiempo base configurado
// en "Tiempos de preparación". Este valor manda sobre el cálculo automático y lo ven mesero, bartender, cliente y admin.
function EditorTiempoManualPedido({ venta }) {
  const { updateItem, log, toast } = useStore();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(venta.tiempoManualMinutos != null ? venta.tiempoManualMinutos : '');
  if (!editando) return /*#__PURE__*/React.createElement("div", { className: "flexrow", style: { gap: 8, marginTop: 4 } }, /*#__PURE__*/
  React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => {setValor(venta.tiempoManualMinutos != null ? venta.tiempoManualMinutos : '');setEditando(true);} }, "\u23F1\uFE0F Poner tiempo real de este pedido"),
  venta.tiempoManualMinutos != null && /*#__PURE__*/React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => {updateItem('sales', venta.id, { tiempoManualMinutos: null });toast('🔄 Vuelve al cálculo automático por fila');} }, "Quitar ajuste manual")
  );
  return /*#__PURE__*/React.createElement("div", { className: "flexrow", style: { gap: 8, marginTop: 4 } }, /*#__PURE__*/
  React.createElement("input", { type: "number", min: "1", style: { width: 90 }, value: valor, onChange: (e) => setValor(e.target.value), placeholder: "min" }), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary btn-sm", onClick: () => {
      const minutos = Math.max(1, Number(valor) || 1);
      updateItem('sales', venta.id, { tiempoManualMinutos: minutos });
      log('Cocinera', 'Puso tiempo real a mano para "' + venta.producto + '": ' + minutos + ' min');
      toast('⏱️ Tiempo real puesto: ' + minutos + ' min — así lo verán el mesero y el bartender');
      setEditando(false);
    } }, "Guardar"), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => setEditando(false) }, "Cancelar")
  );
}
function CocinaComandas() {
  const { state, updateItem, notify, toast } = useStore();
  const cola = comandasEnCola(state);
  function avanzar(c) {
    const siguiente = c.estadoPedido === 'Pedido recibido' ? 'En preparación' : c.estadoPedido === 'En preparación' ? 'Listo' : 'Entregado';
    updateItem('sales', c.id, { estadoPedido: siguiente });
    if (siguiente === 'Listo') {
      if (c.entrega === 'llevar' && c.clienteEmail) {
        notify({ tipo: 'pedido_listo', destino: 'cliente', clienteEmail: c.clienteEmail, clienteNombre: c.clienteNombre, producto: c.producto, cantidad: c.cantidad, mesaNumero: c.mesaNumero, ventaId: c.id, atendido: false, origen: 'cocina' });
        toast('🍽️ Se avisó al cliente que su ' + c.producto + ' ya está lista para llevar');
      } else {
        notify({ tipo: 'pedido_listo', destino: 'mesero', mesero: c.mesero, producto: c.producto, cantidad: c.cantidad, mesaNumero: c.mesaNumero, entrega: c.entrega, ventaId: c.id, atendido: false, origen: 'cocina' });
        toast('🍽️ Pedido de ' + c.producto + ' marcado como Listo — se avisó al mesero');
      }
      toast('✅ Comanda lista y retirada de la fila — las demás suben un lugar');
    } else {
      toast('Comanda actualizada a: ' + siguiente);
    }
  }
  const demoradas = cola.filter((c) => pedidoDemorado(state, c));
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, "Pedidos en preparaci\xF3n"), /*#__PURE__*/
  React.createElement(AvisoCierreCocinaAuto, null), /*#__PURE__*/
  React.createElement(AvisoCierreCocina, null),
  demoradas.length > 0 && /*#__PURE__*/React.createElement("div", { className: "alert danger", style: { marginBottom: 14 } }, "\u23F0 ", /*#__PURE__*/React.createElement("strong", null, demoradas.length, " pedido(s) van tardando m\xE1s de lo estimado"), " \u2014 ", demoradas.map((d) => d.producto).join(', '), "."), /*#__PURE__*/
  React.createElement("p", { className: "small", style: { marginBottom: 12 } }, "\uD83D\uDD22 Las comandas se ordenan autom\xE1ticamente por orden de llegada \u2014 la ", /*#__PURE__*/React.createElement("strong", null, "#1"), " es la m\xE1s antigua y debe atenderse primero. No se pueden reordenar manualmente; una comanda nueva siempre entra al final de la fila. Al marcar \"Listo\", desaparece de aqu\xED y todas las dem\xE1s suben un lugar. Los tiempos estimados los defines t\xFA en \"Tiempos de preparaci\xF3n\" y se suman seg\xFAn cu\xE1ntas \xF3rdenes hay por delante."),
  cola.length === 0 && /*#__PURE__*/React.createElement("p", { className: "small" }, "No hay comandas en fila. \uD83C\uDF89"), /*#__PURE__*/
  React.createElement("div", { className: "grid", style: { gap: 10 } },
  cola.map((c, i) => {
    const estimado = tiempoEstimadoRealVenta(state, c);
    const transcurrido = minutosTranscurridos(c);
    const demorado = transcurrido > estimado;
    const pct = Math.min(100, Math.round(transcurrido / estimado * 100));
    return /*#__PURE__*/React.createElement("div", { key: c.id, className: "card", style: demorado ? { border: '2px solid var(--danger)' } : i === 0 ? { border: '2px solid var(--neon)' } : {} }, /*#__PURE__*/
    React.createElement("div", { className: "flexrow" }, /*#__PURE__*/
    React.createElement("span", { style: { fontSize: 22, fontWeight: 800, color: demorado ? 'var(--danger)' : i === 0 ? 'var(--neon)' : 'var(--ink-dim)', minWidth: 44 } }, "#", i + 1), /*#__PURE__*/
    React.createElement("div", { style: { flex: 1 } }, /*#__PURE__*/
    React.createElement("div", { className: "flexrow" }, /*#__PURE__*/React.createElement("strong", null, c.producto, c.variante ? ' (' + c.variante + ')' : ''), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", { className: "small" }, "\uD83D\uDD50 ", c.hora)), /*#__PURE__*/
    React.createElement("div", { className: "small" }, c.sabor ? 'Sabor: ' + c.sabor + ' · ' : '', "Cant.: ", c.cantidad, " \xB7 Aderezo: ", c.aderezo === null ? '—' : c.aderezo ? 'Sí' : 'No', " \xB7 ", c.entrega === 'llevar' ? 'Para llevar' : c.entrega === 'domicilio' ? 'A domicilio' : 'Consumo en local'), /*#__PURE__*/
    React.createElement("div", { className: "small" }, "\uD83D\uDC64 Mesero: ", /*#__PURE__*/React.createElement("strong", null, infoMeseroCliente(c).mesero), " \xB7 \uD83E\uDDD1 Cliente: ", /*#__PURE__*/React.createElement("strong", null, infoMeseroCliente(c).cliente)),
    c.notas && /*#__PURE__*/React.createElement("div", { className: "small" }, "\uD83D\uDCDD ", c.notas), /*#__PURE__*/
    React.createElement(AvisoPedidoModificado, { venta: c, quien: "cocina" }), /*#__PURE__*/
    React.createElement("div", { style: { marginTop: 6 } }, /*#__PURE__*/
    React.createElement("div", { className: "flexrow small" }, /*#__PURE__*/React.createElement("span", null, "\u23F1\uFE0F ", transcurrido, " / ", estimado, " min", c.tiempoManualMinutos != null ? ' (puesto a mano)' : ''), /*#__PURE__*/React.createElement("span", { className: "spacer" }), demorado && /*#__PURE__*/React.createElement("span", { style: { color: 'var(--danger)', fontWeight: 700 } }, "\u23F0 Tardando m\xE1s de lo estimado")), /*#__PURE__*/
    React.createElement("div", { style: { height: 6, background: 'var(--bg-soft)', borderRadius: 4, marginTop: 4, overflow: 'hidden' } }, /*#__PURE__*/
    React.createElement("div", { style: { height: '100%', width: pct + '%', background: demorado ? 'var(--danger)' : 'var(--neon)', borderRadius: 4 } })
    )
    ), /*#__PURE__*/
    React.createElement(EditorTiempoManualPedido, { venta: c })
    ), /*#__PURE__*/
    React.createElement("span", { className: 'tag ' + (c.estadoPedido === 'En preparación' ? 'warn' : 'info') }, c.estadoPedido || 'Pedido recibido')
    ), /*#__PURE__*/
    React.createElement("button", { className: "btn btn-primary btn-sm", style: { marginTop: 10 }, onClick: () => avanzar(c) },
    c.estadoPedido === 'Pedido recibido' ? 'Empezar preparación' : 'Marcar como Listo ✅'
    )
    );})
  )
  );
}
function AvisarAsistencia({ rol }) {
  const { state, pushTo, toast } = useStore();
  const [tipo, setTipo] = useState('retraso');const [hora, setHora] = useState('');const [nota, setNota] = useState('');
  const empleado = state.staff.find((s) => s.id === state.staffSession) || state.staff.find((s) => s.rol === rol);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, "Avisar retraso o falta"), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { maxWidth: 420 } }, /*#__PURE__*/
  React.createElement(Field, { label: "Tipo" }, /*#__PURE__*/React.createElement("select", { value: tipo, onChange: (e) => setTipo(e.target.value) }, /*#__PURE__*/React.createElement("option", { value: "retraso" }, "Llegar\xE9 tarde"), /*#__PURE__*/React.createElement("option", { value: "falta" }, "Faltar\xE9 hoy"))),
  tipo === 'retraso' && /*#__PURE__*/React.createElement(Field, { label: "Hora estimada de llegada" }, /*#__PURE__*/React.createElement("input", { type: "time", value: hora, onChange: (e) => setHora(e.target.value) })), /*#__PURE__*/
  React.createElement(Field, { label: "Nota (opcional)" }, /*#__PURE__*/React.createElement("input", { value: nota, onChange: (e) => setNota(e.target.value) })), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", style: { marginTop: 10 }, onClick: () => {pushTo('attendanceNotices', { id: uid('att'), empleado: empleado ? empleado.nombre : rol, tipo, hora, nota, fecha: todayISO() });toast('Aviso enviado al administrador');setHora('');setNota('');} }, "Enviar aviso")
  )
  );
}

/* ============================= MESERO ============================= */
const MESERO_SECTIONS = [
{ label: 'Principal', items: [{ key: 'dashboard', label: 'Menú Principal', icon: '📊' }, { key: 'venta', label: 'Registrar venta', icon: '🧾' }, { key: 'pedidos', label: 'Mis pedidos activos', icon: '📋' }, { key: 'cuentasabiertas', label: 'Cuentas abiertas', icon: '🧾' }, { key: 'cubetazos', label: 'Cubetazos', icon: '🪣' }, { key: 'menufisico', label: 'Menú', icon: '📷' }] },
{ label: 'Mi turno', items: [{ key: 'turno', label: 'Zona y días asignados', icon: '🗓️' }, { key: 'asistencia', label: 'Avisar retraso/falta', icon: '⏰' }] },
{ label: 'Desempeño', items: [{ key: 'evaluaciones', label: 'Mis evaluaciones', icon: '⭐' }, { key: 'mesas', label: 'Mesas atendidas', icon: '🪑' }, { key: 'reportes', label: 'Reportes de venta', icon: '📄' }] },
{ label: 'Cuenta', items: [{ key: 'cuenta', label: 'Mi perfil', icon: '⚙️' }] }];

function MeseroView() {
  const { state } = useStore();
  const [section, setSection] = useState('dashboard');
  const mesero = state.staff.find((s) => s.id === state.staffSession) || state.staff.find((s) => s.rol === 'mesero') || { nombre: 'Mesero' };
  const cuentasAbiertasBadge = (state.cuentasAbiertas || []).filter((t) => t.estado === 'solicitando_pago').length;
  const MAP = {
    dashboard: /*#__PURE__*/React.createElement(MeseroDashboard, { goto: setSection, mesero: mesero }), venta: /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, "Registrar venta"), /*#__PURE__*/React.createElement(VentaForm, { meseroDefault: mesero.nombre })),
    pedidos: /*#__PURE__*/React.createElement(MeseroPedidos, { mesero: mesero }), turno: /*#__PURE__*/React.createElement(MeseroTurno, { mesero: mesero }), asistencia: /*#__PURE__*/React.createElement(AvisarAsistencia, { rol: "mesero" }),
    evaluaciones: /*#__PURE__*/React.createElement(MeseroEvaluaciones, { mesero: mesero }), mesas: /*#__PURE__*/React.createElement(MesasMapa, null), menufisico: /*#__PURE__*/React.createElement(MenuFisicoViewer, null), cuenta: /*#__PURE__*/React.createElement(MeseroCuenta, { mesero: mesero }),
    reportes: /*#__PURE__*/React.createElement(ReporteVentasView, { mesero: mesero.nombre }), cubetazos: /*#__PURE__*/React.createElement(MeseroCubetazos, { mesero: mesero }), cuentasabiertas: /*#__PURE__*/React.createElement(CuentasAbiertasPanel, null)
  };
  return /*#__PURE__*/React.createElement(PanelLayout, { sections: MESERO_SECTIONS, section: section, setSection: setSection, badges: { cuentasabiertas: cuentasAbiertasBadge } }, MAP[section]);
}
// Banner reutilizable para Mesero/Bartender: pedidos "Listo" para recoger en barra/cocina, y avisos de demora, destinados a mesero.
// Alerta para el Mesero: la cocina está cerrada (por horario automático o cierre manual) y no se pueden tomar pedidos de comida.
function CocinaCerradaBannerMesero() {
  const { state } = useStore();
  const abierta = cocinaEfectivamenteAbierta(state);
  if (abierta) return null;
  return /*#__PURE__*/React.createElement("div", { className: "alert danger", style: { marginBottom: 16 } }, "\uD83C\uDF73 ", /*#__PURE__*/React.createElement("strong", null, "La cocina est\xE1 cerrada"), " \u2014 disponible desde las ", horaTexto12(cocinaHorarioActual(state).horaApertura), ". No se pueden tomar pedidos de comida por ahora, solo bebidas.");
}
// Banner de disponibilidad de producto en tiempo real (agotado/repuesto) — visible para Mesero y Bartender.
function StockAlertBanner() {
  const { state, updateItem } = useStore();
  const avisos = state.notifications.filter((n) => (n.tipo === 'stock_agotado' || n.tipo === 'stock_repuesto' || n.tipo === 'sabor_agotado') && !n.atendido);
  if (avisos.length === 0) return null;
  return /*#__PURE__*/React.createElement("div", { style: { marginBottom: 16 } },
  avisos.map((n) => /*#__PURE__*/React.createElement("div", { key: n.id, className: 'alert ' + (n.tipo === 'stock_agotado' || n.tipo === 'sabor_agotado' ? 'danger' : ''), style: { marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 } }, /*#__PURE__*/
  React.createElement("span", { style: { flex: 1 } },
  n.tipo === 'stock_agotado' ? '🔴 ' + n.producto + ' fue marcado como AGOTADO por el Cantinero.' :
  n.tipo === 'sabor_agotado' ? '🚫 Sabor ' + n.sabor + ' (' + n.categoria + ') marcado como agotado por ' + (n.reportadoPor || 'el Cantinero') + '.' :
  '🟢 ' + n.producto + ' fue repuesto — ya está disponible de nuevo.'
  ), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => updateItem('notifications', n.id, { atendido: true }) }, "Entendido")
  ))
  );
}
// Banner del Cantinero: bebidas de cortesía pendientes de preparar/entregar (promo de temporada o cumpleaños).
function CortesiasBanner() {
  const { state, updateItem, toast } = useStore();
  const pendientes = state.cortesias.filter((c) => !c.entregada);
  if (pendientes.length === 0) return null;
  function marcarEntregada(c) {updateItem('cortesias', c.id, { entregada: true });toast('🎁 Cortesía entregada a ' + (c.clienteNombre || 'el cliente'));}
  return /*#__PURE__*/React.createElement("div", { style: { marginBottom: 16 } },
  pendientes.map((c) => /*#__PURE__*/React.createElement("div", { key: c.id, className: "alert", style: { marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(200,255,77,.1)', borderColor: 'var(--lime)' } }, /*#__PURE__*/
  React.createElement("span", { style: { flex: 1 } }, c.tipo === 'cumpleanos' ? '🎂' : '🎁', " ", /*#__PURE__*/React.createElement("strong", null, c.clienteNombre || 'Cliente'), " tiene derecho a una cortes\xEDa: ", /*#__PURE__*/React.createElement("strong", null, c.bebida), c.tipo === 'cumpleanos' ? ' (regalo de cumpleaños)' : ' (promoción de temporada)'), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: () => marcarEntregada(c) }, "Entregada")
  ))
  );
}
function PedidosListosBanner({ soloMesero }) {
  const { state, updateItem, toast } = useStore();
  let listos = state.notifications.filter((n) => n.tipo === 'pedido_listo' && n.destino === 'mesero' && !n.atendido);
  let demoras = state.notifications.filter((n) => n.tipo === 'aviso_demora' && n.destino === 'mesero' && !n.atendido);
  if (soloMesero) {listos = listos.filter((n) => n.mesero === soloMesero);demoras = demoras.filter((n) => n.mesero === soloMesero);}
  if (listos.length === 0 && demoras.length === 0) return null;
  function entregar(n) {
    updateItem('notifications', n.id, { atendido: true });
    if (n.ventaId) updateItem('sales', n.ventaId, { estadoPedido: 'Entregado' });
    toast('✅ Pedido entregado');
  }
  function descartarDemora(n) {updateItem('notifications', n.id, { atendido: true });}
  return /*#__PURE__*/React.createElement("div", { style: { marginBottom: 16 } },
  listos.map((n) => /*#__PURE__*/React.createElement("div", { key: n.id, className: "alert", style: { marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 } }, /*#__PURE__*/
  React.createElement("span", { style: { flex: 1 } }, n.origen === 'barra' ? '🥤' : '🍽️', " ", /*#__PURE__*/React.createElement("strong", null, n.producto), " (\xD7", n.cantidad, ") ya est\xE1 lista", n.mesaNumero ? ' — pasa a la barra por la Mesa ' + n.mesaNumero : '', n.entrega && !n.mesaNumero ? ' — ' + (n.entrega === 'domicilio' ? 'a domicilio' : 'para consumir en el local') : ''), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: () => entregar(n) }, "Entregado")
  )),
  demoras.map((n) => /*#__PURE__*/React.createElement("div", { key: n.id, className: "alert danger", style: { marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 } }, /*#__PURE__*/
  React.createElement("span", { style: { flex: 1 } }, "\u23F3 El bartender avisa: ", /*#__PURE__*/React.createElement("strong", null, n.producto), n.mesaNumero ? ' (Mesa ' + n.mesaNumero + ')' : '', " tardar\xE1 ", /*#__PURE__*/React.createElement("strong", null, n.minutos, " min"), " m\xE1s \u2014 ", n.motivo, ". Av\xEDsale al cliente."), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => descartarDemora(n) }, "Entendido")
  ))
  );
}
function MeseroDashboard({ goto, mesero }) {
  const { state, updateItem, toast } = useStore();
  const ventasMesero = state.sales.filter((s) => s.mesero === mesero.nombre);
  const hoy = ventasMesero.filter((s) => s.fecha === todayISO());
  const miAsignacion = zonaDeMesero(state, new Date(), mesero.nombre);
  const rellenosPendientes = state.notifications.filter((n) => n.tipo === 'relleno' && !n.atendido);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Hola, ", mesero.nombre), /*#__PURE__*/
  React.createElement(CocinaCerradaBannerMesero, null), /*#__PURE__*/
  React.createElement(StockAlertBanner, null), /*#__PURE__*/
  React.createElement(PedidosListosBanner, { soloMesero: mesero.nombre }),
  rellenosPendientes.length > 0 && /*#__PURE__*/React.createElement("div", { style: { marginBottom: 16 } },
  rellenosPendientes.map((r) => /*#__PURE__*/React.createElement("div", { key: r.id, className: "alert", style: { marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 } }, /*#__PURE__*/
  React.createElement("span", { style: { flex: 1 } }, "\uD83D\uDD14 Te pidieron rellenar la ", /*#__PURE__*/React.createElement("strong", null, r.mesa), ": ", r.detalle), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: () => {updateItem('notifications', r.id, { atendido: true });toast('✅ Relleno marcado como atendido');} }, "Atendido")
  ))
  ), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-3", style: { marginBottom: 16 } }, /*#__PURE__*/
  React.createElement(KpiCard, { label: "Mesas atendidas hoy", icon: "\uD83E\uDE91", value: hoy.length }), /*#__PURE__*/
  React.createElement(KpiCard, { label: "Ventas registradas hoy", icon: "\uD83D\uDCB0", value: money(hoy.reduce((a, s) => a + s.total, 0)) }), /*#__PURE__*/
  React.createElement(KpiCard, { label: "Zona asignada hoy", icon: "\uD83D\uDCCD", value: miAsignacion ? miAsignacion.zona : 'Sin asignar' })
  ), /*#__PURE__*/
  React.createElement("div", { className: "qa-grid", style: { marginBottom: 16 } }, /*#__PURE__*/
  React.createElement(QuickAction, { icon: "\uD83E\uDDFE", label: "Registrar venta", onClick: () => goto('venta') }), /*#__PURE__*/
  React.createElement(QuickAction, { icon: "\uD83D\uDCD6", label: "Ver cat\xE1logo actualizado", onClick: () => goto('menu') }), /*#__PURE__*/
  React.createElement(QuickAction, { icon: "\u23F0", label: "Avisar retraso", onClick: () => goto('asistencia') })
  ), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/React.createElement("h3", { style: { marginTop: 0 } }, "Mis pedidos activos"), /*#__PURE__*/React.createElement(DataTable, { columns: [{ key: 'hora', label: 'Hora' }, { key: 'producto', label: 'Producto' }, { key: 'estadoPedido', label: 'Estado', render: (r) => r.estadoPedido || 'Pedido recibido' }, { key: 'total', label: 'Total', render: (r) => money(r.total) }], rows: [...hoy].reverse() }))
  );
}
function MeseroPedidos({ mesero }) {
  const { state } = useStore();
  const [cancelando, setCancelando] = useState(null);
  const [editando, setEditando] = useState(null);
  const rows = state.sales.filter((s) => s.mesero === mesero.nombre);
  const esComida = (r) => r.categoria === 'Alitas' || r.categoria === 'Snacks y botanas';
  const modificadosPorBartender = rows.filter((p) => p.ultimaEdicionPor === 'bartender' && p.estadoPedido === 'Pedido recibido');
  const demorados = rows.filter((r) => esComida(r) && pedidoDemorado(state, r));
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, "Mis pedidos activos"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Para los pedidos de comida, el n\xFAmero de turno indica su posici\xF3n en la fila de cocina (orden estricto de llegada) \u2014 puedes informarle ese n\xFAmero al cliente."),
  demorados.length > 0 && /*#__PURE__*/React.createElement("div", { className: "alert danger", style: { marginBottom: 12 } }, "\u23F0 ", /*#__PURE__*/React.createElement("strong", null, demorados.length, " pedido(s) de cocina van tardando m\xE1s de lo estimado"), " \u2014 av\xEDsale al cliente con anticipaci\xF3n."),
  modificadosPorBartender.length > 0 && /*#__PURE__*/React.createElement("div", { className: "alert", style: { marginBottom: 12, borderColor: 'var(--warn)' } }, "\u26A0\uFE0F ", /*#__PURE__*/React.createElement("strong", null, modificadosPorBartender.length, " pedido(s) modificado(s) por el bartender"), " \u2014 revisa los cambios abajo."), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/React.createElement(DataTable, { rowStyle: (r) => r.ultimaEdicionPor === 'bartender' && r.estadoPedido === 'Pedido recibido' ? { background: 'rgba(255,152,0,.12)' } : undefined, columns: [
    { key: 'fecha', label: 'Fecha' }, { key: 'hora', label: 'Hora' },
    { key: 'producto', label: 'Producto', render: (r) => /*#__PURE__*/React.createElement("div", null, r.producto, r.notas ? /*#__PURE__*/React.createElement("div", { className: "small" }, "\uD83D\uDCDD ", r.notas) : null, /*#__PURE__*/React.createElement(AvisoPedidoModificado, { venta: r, quien: "mesero" })) },
    { key: 'entrega', label: 'Entrega' },
    { key: 'turno', label: 'Turno de cocina', render: (r) => esComida(r) ? r.estadoPedido === 'Listo' || r.estadoPedido === 'Entregado' ? /*#__PURE__*/React.createElement("span", { className: "tag ok" }, "Listo") : r.estadoPedido === 'Cancelado' ? /*#__PURE__*/React.createElement("span", { className: "tag danger" }, "Cancelado") : /*#__PURE__*/React.createElement("span", { className: "tag warn" }, "#", turnoDeComanda(state, r.id)) : '—' },
    { key: 'tiempo', label: 'Tiempo de cocina', render: (r) => esComida(r) && r.estadoPedido !== 'Listo' && r.estadoPedido !== 'Entregado' && r.estadoPedido !== 'Cancelado' ? /*#__PURE__*/React.createElement(BarraProgresoCocina, { venta: r }) : '—' },
    { key: 'estadoPedido', label: 'Estado', render: (r) => /*#__PURE__*/React.createElement("span", { className: 'tag ' + (r.estadoPedido === 'Cancelado' ? 'danger' : r.estadoPedido === 'Listo' || r.estadoPedido === 'Entregado' ? 'ok' : 'warn') }, r.estadoPedido || 'Pedido recibido', r.estadoPedido === 'Cancelado' && r.motivoCancelacion ? ' — ' + r.motivoCancelacion : '') },
    { key: 'total', label: 'Total', render: (r) => money(r.total) },
    { key: 'acciones', label: '', render: (r) => /*#__PURE__*/React.createElement("div", { className: "flexrow", style: { gap: 6, flexWrap: 'wrap' } }, /*#__PURE__*/
      React.createElement(AccionesEdicionPedido, { venta: r, quien: "mesero", onEditar: setEditando }),
      r.estadoPedido !== 'Entregado' && r.estadoPedido !== 'Cancelado' && /*#__PURE__*/React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => setCancelando(r) }, "\u274C Cancelar")
      ) }],
    rows: [...rows].reverse() })), /*#__PURE__*/
  React.createElement(ModalCancelarPedido, { venta: cancelando, quien: "Mesero", onCerrar: () => setCancelando(null) }), /*#__PURE__*/
  React.createElement(ModalEditarPedido, { venta: editando, quien: "mesero", onCerrar: () => setEditando(null) })
  );
}
function MeseroTurno({ mesero }) {
  const { state } = useStore();
  const dias = [...Array(7)].map((_, i) => {const d = new Date();d.setDate(d.getDate() - d.getDay() + i);return d;});
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Zona y d\xEDas asignados"), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("div", { className: "small", style: { marginBottom: 10 } }, "Cada d\xEDa trabajan los dos meseros, uno en Interior y otro en Corredor. La asignaci\xF3n base alterna por semana, pero el administrador puede reasignar cualquier d\xEDa desde \"Turnos y Zonas\"."),
  dias.map((d) => {
    const zonas = zonasEfectivasDelDia(state, d);
    const miZona = ['Interior', 'Corredor'].find((z) => zonas[z].mesero === mesero.nombre);
    return /*#__PURE__*/React.createElement("div", { key: d.toISOString(), className: "flexrow", style: { padding: '8px 0', borderBottom: '1px solid var(--line)' } }, /*#__PURE__*/
    React.createElement("span", { style: { width: 130 } }, DIAS[d.getDay()]), /*#__PURE__*/
    React.createElement("span", { className: 'tag ' + (miZona ? 'ok' : 'info') }, miZona || 'Sin turno'),
    miZona && /*#__PURE__*/React.createElement("span", { className: "small", style: { marginLeft: 8 } }, "\u2190 Tu turno", zonas[miZona].asignadoPorAdmin ? ' (asignado por el admin)' : ''),
    !miZona && /*#__PURE__*/React.createElement("span", { className: "small", style: { marginLeft: 8 } }, "Interior: ", zonas.Interior.mesero || '—', " \xB7 Corredor: ", zonas.Corredor.mesero || '—')
    );
  }), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { marginTop: 14, background: 'var(--bg-soft)' } }, "\uD83D\uDCC5 ", /*#__PURE__*/
  React.createElement("strong", null, "Tarjeta de calendario simulada (Google Calendar)"), /*#__PURE__*/
  React.createElement("div", { className: "small" }, "Zona y d\xEDas asignados de ", mesero.nombre, " sincronizados de forma ficticia \u2014 sin conexi\xF3n real a Google.")
  )
  )
  );
}
function MeseroEvaluaciones({ mesero }) {
  const { state, updateItem } = useStore();
  const evals = state.evaluations.filter((e) => e.meseroNombre === mesero.nombre);
  const sanciones = state.tableSanciones.filter((s) => s.meseroId === mesero.id);
  useEffect(() => {evals.forEach((e) => {if (!e.vistaAdmin) updateItem('evaluations', e.id, { vistaAdmin: true });});}, []);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, "Mis evaluaciones de cierre"),
  evals.length === 0 && /*#__PURE__*/React.createElement("p", { className: "small" }, "A\xFAn no tienes evaluaciones."),
  [...evals].reverse().map((ev) => /*#__PURE__*/React.createElement("div", { key: ev.id, className: "card", style: { marginBottom: 10 } }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow" }, /*#__PURE__*/React.createElement(StarRating, { value: ev.stars, onChange: () => {} }), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", { className: "small" }, ev.fecha)),
  ev.comentario && /*#__PURE__*/React.createElement("div", { className: "small", style: { marginTop: 6 } }, "Observaci\xF3n: \"", ev.comentario, "\"")
  )), /*#__PURE__*/
  React.createElement("h2", { style: { marginTop: 24 } }, "Sanciones por bloqueo de mesas"),
  sanciones.length === 0 && /*#__PURE__*/React.createElement("p", { className: "small" }, "No tienes sanciones registradas."),
  [...sanciones].reverse().map((s) => /*#__PURE__*/React.createElement("div", { key: s.id, className: "card", style: { marginBottom: 10, borderColor: 'var(--danger)' } }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow" }, /*#__PURE__*/React.createElement("span", { className: "tag danger" }, "\u26A0\uFE0F Sanci\xF3n"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", { className: "small" }, s.fecha, " ", s.hora)), /*#__PURE__*/
  React.createElement("div", { className: "small", style: { marginTop: 6 } }, "Mesa ", s.mesaNumero, " (", s.zona, ") \u2014 ", s.motivo)
  ))
  );
}
// Reporte de venta por día laboral, para Mesero (el suyo) y Bartender (cualquier mesero).
// Muestra producto, precio, cambio entregado y el total del día (ganancia), como un ticket.
function ReporteVentasView({ mesero, permitirElegirMesero }) {
  const { state } = useStore();
  const meseros = state.staff.filter((s) => s.rol === 'mesero');
  const [meseroSel, setMeseroSel] = useState(mesero || meseros[0]?.nombre || '');
  const [verDia, setVerDia] = useState(null);
  const ventasDelMesero = state.sales.filter((s) => s.mesero === meseroSel);
  const porDia = {};
  ventasDelMesero.forEach((v) => {(porDia[v.fecha] = porDia[v.fecha] || []).push(v);});
  const dias = Object.keys(porDia).sort().reverse();
  function resumen(fecha) {
    const ventas = [...porDia[fecha]].sort((a, b) => a.hora.localeCompare(b.hora));
    return { ventas, total: ventas.reduce((a, v) => a + v.total, 0), cambio: ventas.reduce((a, v) => a + (v.cambio || 0), 0), cantidad: ventas.length };
  }
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Reportes de venta"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Un reporte por cada d\xEDa que trabaj\xF3 \u2014 con el producto, el precio, el cambio entregado y el total vendido (ganancia) de ese d\xEDa. Si un mesero trabaj\xF3 solo 3 d\xEDas, aqu\xED aparecen exactamente esos 3 reportes."),
  permitirElegirMesero && /*#__PURE__*/React.createElement(Field, { label: "Mesero" }, /*#__PURE__*/React.createElement("select", { value: meseroSel, onChange: (e) => setMeseroSel(e.target.value) },
  meseros.map((m) => /*#__PURE__*/React.createElement("option", { key: m.id, value: m.nombre }, m.nombre))
  )),
  dias.length === 0 && /*#__PURE__*/React.createElement("p", { className: "small" }, "Sin d\xEDas con ventas registradas para ", meseroSel || '—', "."), /*#__PURE__*/
  React.createElement("div", { className: "grid grid-3" },
  dias.map((f) => {const r = resumen(f);return /*#__PURE__*/React.createElement("div", { key: f, className: "card" }, /*#__PURE__*/
    React.createElement("div", { style: { fontWeight: 700 } }, fmtDate(f)), /*#__PURE__*/
    React.createElement("div", { className: "small" }, r.cantidad, " pedido(s) atendidos"), /*#__PURE__*/
    React.createElement("div", { style: { fontSize: 18, fontWeight: 800, color: 'var(--ok)', margin: '6px 0' } }, money(r.total)), /*#__PURE__*/
    React.createElement("div", { className: "small" }, "Cambio entregado: ", money(r.cambio)), /*#__PURE__*/
    React.createElement("button", { className: "btn btn-secondary btn-sm", style: { marginTop: 8 }, onClick: () => setVerDia(f) }, "\uD83D\uDC41\uFE0F Ver ticket del d\xEDa")
    );})
  ),
  verDia && /*#__PURE__*/React.createElement(Modal, { title: 'Reporte de venta — ' + fmtDate(verDia), onClose: () => setVerDia(null) }, /*#__PURE__*/
  React.createElement("div", { style: { textAlign: 'center', marginBottom: 10 } }, /*#__PURE__*/
  React.createElement("div", { style: { fontFamily: 'var(--font-display)', fontSize: 20 } }, "\uD83D\uDC51 EL REY"), /*#__PURE__*/
  React.createElement("div", { className: "small" }, "Reporte de venta de ", meseroSel), /*#__PURE__*/
  React.createElement("div", { className: "small" }, fmtDate(verDia))
  ), /*#__PURE__*/
  React.createElement("hr", { className: "line" }),
  resumen(verDia).ventas.map((v) => /*#__PURE__*/React.createElement("div", { key: v.id, className: "small", style: { marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--line)' } }, /*#__PURE__*/
  React.createElement("div", { className: "flexrow" }, /*#__PURE__*/React.createElement("strong", null, v.hora), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", null, money(v.total))), /*#__PURE__*/
  React.createElement("div", null, v.producto, v.variante ? ' (' + v.variante + ')' : '', " \xD7 ", v.cantidad), /*#__PURE__*/
  React.createElement("div", null, "Pago: ", v.pago === 'efectivo' ? 'Efectivo' : 'Transferencia', v.pago === 'efectivo' ? ' · Cambio: ' + money(v.cambio || 0) : '')
  )), /*#__PURE__*/
  React.createElement("hr", { className: "line" }), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { fontWeight: 800, fontSize: 16 } }, /*#__PURE__*/React.createElement("span", null, "Total del d\xEDa (ganancia)"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", null, money(resumen(verDia).total))), /*#__PURE__*/
  React.createElement("div", { className: "flexrow small" }, /*#__PURE__*/React.createElement("span", null, "Cambio total entregado a clientes"), /*#__PURE__*/React.createElement("span", { className: "spacer" }), /*#__PURE__*/React.createElement("span", null, money(resumen(verDia).cambio))), /*#__PURE__*/
  React.createElement("div", { className: "small", style: { marginTop: 4 } }, "Pedidos atendidos ese d\xEDa: ", resumen(verDia).cantidad)
  )
  );
}
function MesasMapa() {
  const { state, updateItem, toast } = useStore();
  const mesero = state.staff.find((s) => s.id === state.staffSession);
  const zonasHoy = zonasEfectivasDelDia(state, new Date());
  const miAsignacion = mesero ? zonaDeMesero(state, new Date(), mesero.nombre) : null;
  const miZonaHoy = miAsignacion ? miAsignacion.zona : null;
  function cycle(t) {
    if (t.estado === 'libre') {
      if (!miZonaHoy) {
        toast('⛔ Hoy no tienes una zona asignada. Pide al administrador que te asigne una en "Turnos y Zonas".');
        return;
      }
      if (t.zona !== miZonaHoy) {
        toast('⛔ Hoy tu zona asignada es ' + miZonaHoy + '. Esas mesas de ' + t.zona + ' le tocan a otro mesero.');
        return;
      }
      updateItem('tables', t.id, { estado: 'ocupada', ocupadaPor: mesero?.id || null, ocupadaPorNombre: mesero?.nombre || '—', horaOcupada: nowTime() });
      toast('🔒 Mesa ' + t.numero + ' marcada como ocupada por ti. Ya puedes tomar la orden desde "Registrar venta".');
      return;
    }
    if (t.estado === 'ocupada') {
      if (t.ocupadaPor && t.ocupadaPor !== mesero?.id) {
        toast('🔒 Mesa bloqueada por ' + (t.ocupadaPorNombre || 'otro mesero') + '. Solo esa persona puede liberarla.');
        return;
      }
      updateItem('tables', t.id, { estado: 'libre', ocupadaPor: null, ocupadaPorNombre: null, horaOcupada: null });
      toast('Mesa ' + t.numero + ' liberada.');
      return;
    }
    if (t.estado === 'reservada') {
      updateItem('tables', t.id, { estado: 'libre', ocupadaPor: null, ocupadaPorNombre: null, horaOcupada: null });
      return;
    }
  }
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Mapa de mesas"), /*#__PURE__*/
  React.createElement("div", { className: "alert", style: { marginBottom: 14 } }, "\uD83D\uDCCD Hoy (",
  DIAS[new Date().getDay()], "): ", /*#__PURE__*/React.createElement("strong", null, "Interior"), " \u2192 ", zonasHoy.Interior.mesero || '—', zonasHoy.Interior.asignadoPorAdmin && /*#__PURE__*/React.createElement("span", { className: "tag warn", style: { marginLeft: 4 } }, "asignado por admin"),
  ' ', "\xB7 ", /*#__PURE__*/React.createElement("strong", null, "Corredor"), " \u2192 ", zonasHoy.Corredor.mesero || '—', zonasHoy.Corredor.asignadoPorAdmin && /*#__PURE__*/React.createElement("span", { className: "tag warn", style: { marginLeft: 4 } }, "asignado por admin"),
  mesero && (miZonaHoy ? ' — Tú atiendes ' + miZonaHoy + ' hoy.' : ' — Hoy no tienes zona asignada.')
  ), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Clic en una mesa libre de tu zona para marcarla como ocupada \u2014 queda bloqueada para los dem\xE1s meseros hasta que t\xFA la liberes, y desde ah\xED ya puedes registrar la orden con esa mesa. Solo puedes ocupar mesas de la zona que te asign\xF3 el administrador ese d\xEDa. Si la bloqueas sin que haya clientes reales, el bartender puede liberarla y aplicarte una sanci\xF3n."),
  ['Interior', 'Corredor'].map((zona) => /*#__PURE__*/React.createElement("div", { key: zona, className: "card", style: { marginBottom: 14 } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, zona, " ", miZonaHoy === zona && /*#__PURE__*/React.createElement("span", { className: "tag ok" }, "Tu zona hoy")), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { flexWrap: 'wrap' } }, state.tables.filter((t) => t.zona === zona).map((t) => /*#__PURE__*/React.createElement("div", { key: t.id, style: { textAlign: 'center' } }, /*#__PURE__*/
  React.createElement("div", { className: 'mesa ' + t.estado, onClick: () => cycle(t) }, t.numero),
  t.estado === 'ocupada' && /*#__PURE__*/React.createElement("div", { className: "small", style: { maxWidth: 64 } }, t.ocupadaPor === mesero?.id ? 'Tú' : t.ocupadaPorNombre || '—')
  )))
  ))
  );
}
function BarMesasSanciones() {
  const { state, updateItem, pushTo, toast } = useStore();
  const [sancionando, setSancionando] = useState(null);
  const [motivo, setMotivo] = useState('');
  function liberarForzado(t) {
    updateItem('tables', t.id, { estado: 'libre', ocupadaPor: null, ocupadaPorNombre: null, horaOcupada: null });
    toast('Mesa ' + t.numero + ' liberada por el bartender.');
  }
  function registrarSancion() {
    if (!motivo.trim()) {toast('Escribe el motivo de la sanción');return;}
    pushTo('tableSanciones', { id: uid('san'), mesaId: sancionando.id, mesaNumero: sancionando.numero, zona: sancionando.zona,
      meseroId: sancionando.ocupadaPor || null, meseroNombre: sancionando.ocupadaPorNombre || '—', motivo, fecha: todayISO(), hora: nowTime() });
    toast('⚠️ Sanción registrada para ' + (sancionando.ocupadaPorNombre || 'el mesero'));
    setSancionando(null);setMotivo('');
  }
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/
  React.createElement("h1", null, "Mesas y sanciones"), /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Si detectas que un mesero marc\xF3 una mesa como ocupada sin que haya clientes reales (para \"reservarla\" indebidamente), puedes liberarla aqu\xED y registrar una sanci\xF3n con motivo."),
  ['Interior', 'Corredor'].map((zona) => /*#__PURE__*/React.createElement("div", { key: zona, className: "card", style: { marginBottom: 14 } }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, zona), /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { flexWrap: 'wrap', gap: 16 } }, state.tables.filter((t) => t.zona === zona).map((t) => /*#__PURE__*/React.createElement("div", { key: t.id, style: { textAlign: 'center' } }, /*#__PURE__*/
  React.createElement("div", { className: 'mesa ' + t.estado }, t.numero),
  t.estado === 'ocupada' && /*#__PURE__*/React.createElement("div", { className: "small", style: { maxWidth: 110 } },
  t.ocupadaPorNombre || '—', /*#__PURE__*/
  React.createElement("div", { className: "flexrow", style: { justifyContent: 'center', marginTop: 4 } }, /*#__PURE__*/
  React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => liberarForzado(t) }, "Liberar"), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => setSancionando(t) }, "\u26A0\uFE0F")
  )
  )
  )))
  )), /*#__PURE__*/
  React.createElement("div", { className: "card" }, /*#__PURE__*/
  React.createElement("h3", { style: { marginTop: 0 } }, "Historial de sanciones"), /*#__PURE__*/
  React.createElement(DataTable, { emptyText: "Sin sanciones registradas.", columns: [
    { key: 'fecha', label: 'Fecha' }, { key: 'hora', label: 'Hora' }, { key: 'meseroNombre', label: 'Mesero' }, { key: 'mesaNumero', label: 'Mesa' }, { key: 'zona', label: 'Zona' }, { key: 'motivo', label: 'Motivo' }],
    rows: [...state.tableSanciones].reverse() })
  ),
  sancionando && /*#__PURE__*/React.createElement(Modal, { title: 'Sancionar por bloqueo de Mesa ' + sancionando.numero, onClose: () => setSancionando(null) }, /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Mesero: ", /*#__PURE__*/React.createElement("strong", null, sancionando.ocupadaPorNombre || '—')), /*#__PURE__*/
  React.createElement(Field, { label: "Motivo de la sanci\xF3n" }, /*#__PURE__*/React.createElement("textarea", { rows: 3, value: motivo, onChange: (e) => setMotivo(e.target.value) })), /*#__PURE__*/
  React.createElement("button", { className: "btn btn-primary", style: { marginTop: 10 }, onClick: registrarSancion }, "Registrar sanci\xF3n")
  )
  );
}
function MeseroCuenta({ mesero }) {
  const { updateItem, toast } = useStore();
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, "Mi cuenta"), /*#__PURE__*/
  React.createElement(PerfilCard, { persona: mesero, onGuardar: (patch) => {updateItem('staff', mesero.id, patch);toast('✅ Perfil actualizado');} }), /*#__PURE__*/
  React.createElement("div", { className: "card", style: { maxWidth: 420, marginTop: 14 } }, /*#__PURE__*/
  React.createElement("p", { className: "small" }, "Cuenta bancaria (para transferencias de clientes): ", /*#__PURE__*/React.createElement("strong", null, mesero.cuentaBanco || 'No registrada')), /*#__PURE__*/
  React.createElement(ThemeToggle, null)
  )
  );
}

/* ============================= APP ROOT ============================= */
// Vigía silencioso (Forma 1, automático): detecta cuándo la cocina cambia de estado por el horario diario
// (sin intervención manual) y notifica al Administrador una sola vez por cada cambio, con la hora y "automático".
function CocinaAutoWatcher() {
  const { state, setState, notify } = useStore();
  useEffect(() => {
    const revisar = () => {
      setState((s) => {
        const manual = s.cocinaManual;
        if (manual && manual.fecha === todayISO()) return s; // hay un override manual vigente hoy: no hay evento "automático" que avisar
        const abierta = cocinaAbiertaPorHorarioDiario(s);
        const ultimo = s.cocinaUltimoAvisoAuto;
        const yaAvisado = ultimo && ultimo.fecha === todayISO() && ultimo.abierta === abierta;
        if (yaAvisado) return s;
        notify({ tipo: 'cocina_estado', estado: abierta ? 'abierta' : 'cerrada', automatico: true, por: 'Sistema (automático)' });
        return { ...s, cocinaUltimoAvisoAuto: { fecha: todayISO(), abierta } };
      });
    };
    revisar();
    const t = setInterval(revisar, 20000);
    return () => clearInterval(t);
  }, []);
  return null;
}
// Vigía de demoras en cocina: si un pedido lleva más tiempo del estimado sin marcarse "Listo", avisa una sola
// vez a la Cocinera y al Mesero (vía notificación) — el aviso visual en vivo ya lo calculan sus propios paneles.
function DemoraCocinaWatcher() {
  const { setState, notify } = useStore();
  useEffect(() => {
    const revisar = () => {
      setState((s) => {
        const cola = comandasEnCola(s);
        let cambiado = false;
        const nuevasSales = s.sales.map((venta) => {
          if (venta.alertaDemoraEnviada) return venta;
          if (!cola.some((c) => c.id === venta.id)) return venta;
          if (!pedidoDemorado(s, venta)) return venta;
          cambiado = true;
          notify({ tipo: 'pedido_demorado', producto: venta.producto, mesero: venta.mesero, ventaId: venta.id, estimado: tiempoEstimadoRealVenta(s, venta), transcurrido: minutosTranscurridos(venta), atendido: false });
          return { ...venta, alertaDemoraEnviada: true };
        });
        if (!cambiado) return s;
        return { ...s, sales: nuevasSales };
      });
    };
    revisar();
    const t = setInterval(revisar, 20000);
    return () => clearInterval(t);
  }, []);
  return null;
}
function AppShell() {
  const { state, logoutStaff } = useStore();
  const staffActual = state.staff.find((s) => s.id === state.staffSession);
  const [sidebarOculta, setSidebarOculta] = useState(false);
  return /*#__PURE__*/React.createElement(SidebarCtx.Provider, { value: { oculta: sidebarOculta, toggle: () => setSidebarOculta((o) => !o) } }, /*#__PURE__*/
  React.createElement("div", null, /*#__PURE__*/
  React.createElement("div", { className: "topbar" }, /*#__PURE__*/
  React.createElement("div", { className: 'brand ' + (staffActual ? 'brand-toggle' : ''), onClick: () => staffActual && setSidebarOculta((o) => !o), title: staffActual ? 'Mostrar/ocultar menú' : '' }, /*#__PURE__*/React.createElement("span", { className: "crown" }, "\uD83D\uDC51"), " EL REY"), /*#__PURE__*/
  React.createElement("div", { className: "flexrow" },
  staffActual && /*#__PURE__*/React.createElement("span", { className: "small", style: { fontWeight: 700 } }, "\uD83D\uDD12 ", staffActual.nombre, " \xB7 ", staffActual.rol),
  staffActual && /*#__PURE__*/React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: logoutStaff }, "Cerrar sesi\xF3n"),
  state.role !== 'cliente' && /*#__PURE__*/React.createElement(ThemeToggle, null)
  )
  ), /*#__PURE__*/
  React.createElement(CocinaAutoWatcher, null), /*#__PURE__*/
  React.createElement(DemoraCocinaWatcher, null),
  state.role === 'cliente' && /*#__PURE__*/React.createElement(ClienteView, null),
  state.role !== 'cliente' && !staffActual && /*#__PURE__*/React.createElement("div", { style: { padding: '60px 20px' } }, /*#__PURE__*/React.createElement(LoginUnico, null)),
  state.role === 'admin' && staffActual && /*#__PURE__*/React.createElement(AdminView, null),
  state.role === 'bartender' && staffActual && /*#__PURE__*/React.createElement(BartenderView, null),
  state.role === 'cocina' && staffActual && /*#__PURE__*/React.createElement(CocinaView, null),
  state.role === 'mesero' && staffActual && /*#__PURE__*/React.createElement(MeseroView, null), /*#__PURE__*/
  React.createElement(GlobalThemeAnimation, null), /*#__PURE__*/
  React.createElement(Toasts, null)
  )
  );
}

function App() {
  return /*#__PURE__*/React.createElement(StoreProvider, null, /*#__PURE__*/React.createElement(AppShell, null));
}

ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));