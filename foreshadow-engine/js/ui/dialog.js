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
      dialog.close();
      if (onConfirm) onConfirm();
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
