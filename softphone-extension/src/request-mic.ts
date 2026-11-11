// Página visível da extensão só para conceder o microfone. A permissão vale
// para toda a origem chrome-extension://<id>, inclusive o documento offscreen.
const msg = document.getElementById('msg')!;

try {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((t) => t.stop());
  msg.textContent = 'Microfone liberado. Pode fechar esta janela e ligar de novo.';
  msg.className = 'ok';
  setTimeout(() => window.close(), 2500);
} catch (e: any) {
  msg.textContent = 'Não foi possível acessar o microfone: ' + (e?.message ?? String(e));
  msg.className = 'err';
}

export {};
