"use client";

import * as React from "react";

/**
 * Preferencia "barra lateral contraída", compartida entre el `Sidebar` (botón
 * "Contraer menú") y el switch de la pantalla de Configuración de cuenta. Se
 * guarda por usuario/navegador en localStorage — es una preferencia cosmética,
 * no un dato de negocio, no va a BD.
 *
 * Contrato SSR CRÍTICO (ver el comentario extenso de `sidebar.tsx`): el estado
 * arranca SIEMPRE `false` en el primer paint (SSR + primer render del cliente)
 * y el valor persistido se aplica recién en un efecto de montaje. El className
 * del `<aside>` es SSR-crítico, así que inicializar desde localStorage causaría
 * un mismatch de hidratación. `aplicada` avisa cuándo ya se aplicó la
 * preferencia, para que el consumidor habilite la transición SOLO después (así
 * la corrección expandido→contraído del primer render es instantánea).
 *
 * Sincronización viva: cuando cambia la preferencia (desde el sidebar o desde
 * Configuración), se emite un evento propio para que TODAS las instancias
 * montadas en la misma pestaña se re-lean; `storage` cubre el caso cross-tab.
 */
const CLAVE_MENU_CONTRAIDO = "plataforma:sidebar-contraido";
const EVENTO_CAMBIO = "plataforma:sidebar-contraido-cambio";

function leerContraido(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CLAVE_MENU_CONTRAIDO) === "1";
  } catch {
    return false;
  }
}

function guardarContraido(contraido: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (contraido) window.localStorage.setItem(CLAVE_MENU_CONTRAIDO, "1");
    else window.localStorage.removeItem(CLAVE_MENU_CONTRAIDO);
  } catch {
    // localStorage no disponible (modo privado/cuota): la preferencia no se
    // persiste, pero el flujo nunca se rompe.
  }
}

export interface PreferenciaSidebar {
  /** `true` si la barra lateral debe estar contraída. Arranca `false` en SSR. */
  contraida: boolean;
  /** `true` una vez que se aplicó la preferencia persistida (post-montaje). */
  aplicada: boolean;
  /** Setea, persiste y notifica a las demás instancias montadas. */
  setContraida: (valor: boolean) => void;
}

export function usePreferenciaSidebarContraida(): PreferenciaSidebar {
  const [contraida, setContraidaEstado] = React.useState(false);
  const [aplicada, setAplicada] = React.useState(false);

  React.useEffect(() => {
    setContraidaEstado(leerContraido());
    setAplicada(true);

    function resincronizar() {
      setContraidaEstado(leerContraido());
    }
    window.addEventListener(EVENTO_CAMBIO, resincronizar);
    window.addEventListener("storage", resincronizar);
    return () => {
      window.removeEventListener(EVENTO_CAMBIO, resincronizar);
      window.removeEventListener("storage", resincronizar);
    };
  }, []);

  const setContraida = React.useCallback((valor: boolean) => {
    setContraidaEstado(valor);
    guardarContraido(valor);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(EVENTO_CAMBIO));
    }
  }, []);

  return { contraida, aplicada, setContraida };
}
