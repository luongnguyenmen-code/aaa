
    // Tự động kiểm tra: nếu Sòng Bạc đang tắt trên server thì chuyển hướng về trang chủ
    fetch(ST25API.routes.casinoStats).then(r => { if (r.status === 404) window.location.replace('index.html'); }).catch(() => {});
  
