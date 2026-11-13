// Endereços definidos NA HORA DO BUILD (ver build.mjs). A extensão não tem mais
// tela de configuração de conectividade: cada build já sai apontando para o seu
// backend. Para outro ambiente/parceiro, gere outro build.
declare const __BACKEND_URL__: string;
declare const __BUILD_INFO__: string;

/** Origem do backend Comunic.SIP, sem barra no fim (ex.: https://177.93.130.128). */
export const BACKEND_URL: string = __BACKEND_URL__.replace(/\/+$/, '');
/** Texto curto mostrado em Ajustes → Sobre (data do build). */
export const BUILD_INFO: string = __BUILD_INFO__;
