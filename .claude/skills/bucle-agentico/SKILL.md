---
name: bucle-agentico
description: "Ejecutar features complejas de factura-electronica.app por fases, con mapeo de contexto real antes de generar las subtareas de cada fase. Activar cuando la tarea toca BD + lógica + UI coordinadas, varios archivos con dependencias entre sí, o una tarea grande del plan. NO usar para fixes puntuales o componentes sueltos."
allowed-tools: Read, Grep, Glob, Write, Edit, Bash, TodoWrite
---

# Bucle agéntico — construcción por fases con contexto real

> "No planifiques lo que no entendés. Mapeá contexto, luego planificá."

Regla central: se generan solo **FASES** al inicio. Las **subtareas de cada fase se generan al entrar a ella**, después de mapear el estado real del sistema — nunca por adelantado sobre suposiciones.

## Cuándo usar
- Tareas grandes del plan que integran BD + lógica + UI.
- Cambios que atraviesan varias capas con dependencias entre sí.
- NO para: un fix, un componente aislado, una migración simple. Eso va directo con el agente especialista.

## Los 5 pasos

### PASO 1 — Delimitar y descomponer en FASES
- Entender el problema final completo (leer la tarea en el plan y la sección del spec que la define).
- Romper en fases ordenadas cronológicamente, con sus dependencias.
- **NO generar subtareas todavía.** Registrar solo las fases con TodoWrite.

### PASO 2 — Entrar a la fase N: MAPEAR contexto real
Antes de generar subtareas, explorar:
- **Codebase** (Grep/Glob/Read): qué existe relacionado, qué patrones usa el proyecto, qué se puede reusar.
- **Base de datos (MCP de Supabase, solo lectura):** qué tablas/políticas/índices existen de verdad.
- **Reglas de negocio:** releer la regla dura de CLAUDE.md que aplica.
- **Fases anteriores:** qué quedó construido, qué se puede asumir.

DESPUÉS de mapear → generar las subtareas específicas de esta fase y actualizar TodoWrite.

### PASO 3 — Ejecutar las subtareas
Por cada subtarea: marcar in_progress → implementar → validar (MCP de Playwright para UI, suite de Vitest para lógica) → marcar completed.
- Si algo falla → PASO 3.5.
- Delegar al agente especialista cuando corresponda (arquitecto-db para migraciones, backend-app para lógica de aplicación, ui-app para pantallas).

### PASO 3.5 — AUTO-BLINDAJE (cuando hay errores)
1. **Arreglar** la causa raíz. 2. **Testear** (dejar test de regresión). 3. **Documentar** con el formato y la tabla de capas definidos en CLAUDE.md (§ Auto-blindaje): notas de tarea en el doc de progreso / agente relevante / CLAUDE.md según el alcance del aprendizaje. 4. Continuar.

### PASO 4 — Transicionar a la siguiente fase
- Confirmar que la fase está REALMENTE completa (no asumir): tests en verde, verificación con MCP si tocó BD o UI.
- Volver al PASO 2 con la siguiente fase — el contexto ahora incluye lo construido.

### PASO 5 — Validación final
- Correr el flujo punta a punta (qa-tests: Vitest + Playwright del flujo crítico que tocó la feature).
- Confirmar contra los criterios de la tarea en el plan y la sección del spec.
- Avisar al project-manager para actualizar el doc de progreso y reportar qué se construyó.

## Reglas
- Nunca generar todas las subtareas del proyecto por adelantado: solo las de la fase activa.
- El MCP de Supabase se usa para LEER/verificar; los cambios de esquema van por migraciones (regla de arquitecto-db).
- Si a mitad de una fase el mapeo revela que el plan de fases estaba mal → ajustar las fases, decirlo explícitamente, y seguir. No forzar un plan roto.
