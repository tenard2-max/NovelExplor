/** 다이얼로그 */

export function showDialog({ title, bodyHtml, onConfirm }) {
  const dialog = document.getElementById('dialog');
  document.getElementById('dialog-title').textContent = title;
  document.getElementById('dialog-body').innerHTML = bodyHtml;

  return new Promise((resolve) => {
    const form = dialog.querySelector('.dialog-form');
    const cancel = document.getElementById('dialog-cancel');

    const cleanup = () => {
      cancel.removeEventListener('click', onCancel);
      form.removeEventListener('submit', onSubmit);
    };

    const onCancel = () => {
      cleanup();
      dialog.close();
      resolve(false);
    };

    const onSubmit = (e) => {
      e.preventDefault();
      cleanup();
      // close 전에 선택값을 읽어야 함 (method=dialog 닫힌 뒤 DOM이 비는 경우 대비)
      if (onConfirm) onConfirm();
      dialog.close();
      resolve(true);
    };

    cancel.addEventListener('click', onCancel);
    form.addEventListener('submit', onSubmit);
    dialog.showModal();
  });
}

export function showAlert(title, message) {
  return showDialog({ title, bodyHtml: `<p>${message}</p>`, onConfirm: null });
}
