// QR Code functionality for mObywatel app

// Handle scan QR action
document.querySelector('.action.scan')?.addEventListener('click', function() {
    // Create scanner interface
    showQRScanner();
});

// Handle show QR action  
document.querySelector('.action.show')?.addEventListener('click', function() {
    // Generate and show QR code
    showQRCode();
});

function showQRScanner() {
    const container = document.querySelector('.container');
    
    // Create scanner interface
    const scannerHTML = `
        <div class="scanner-container">
            <div class="top_grid_fixed">
                <div class="action_grid_fixed">
                    <p onclick="location.reload()" class="back_text_fixed">Wróć</p>
                </div>
                <p class="title_text_fixed">Zeskanuj kod QR</p>
            </div>
            
            <div class="scanner-content">
                <div id="qr-scanner" style="width: 100%; height: 300px; margin: 20px auto; background: #000; border-radius: 10px;"></div>
                <p class="scanner-info">Skieruj kamerę na kod QR</p>
                <p class="scanner-status" id="scanner-status">Przygotowywanie kamery...</p>
            </div>
        </div>
    `;
    
    container.innerHTML = scannerHTML;
    
    // Initialize QR scanner
    if (typeof Html5Qrcode !== 'undefined') {
        const html5QrCode = new Html5Qrcode("qr-scanner");
        
        html5QrCode.start(
            { facingMode: "environment" },
            {
                fps: 10,
                qrbox: { width: 250, height: 250 }
            },
            (decodedText, decodedResult) => {
                // Handle successful scan
                html5QrCode.stop();
                handleScannedCode(decodedText);
            },
            (errorMessage) => {
                // Handle scan error (usually just no QR code found)
            }
        ).catch(err => {
            document.getElementById('scanner-status').textContent = 'Błąd dostępu do kamery: ' + err;
        });
        
        document.getElementById('scanner-status').textContent = 'Skanowanie aktywne...';
    } else {
        document.getElementById('scanner-status').textContent = 'Błąd: Biblioteka skanera nie została załadowana';
    }
}

function showQRCode() {
    const container = document.querySelector('.container');
    
    // Generate QR code data
    const userData = {
        pesel: localStorage.getItem('pesel') || '12345678901',
        firstName: localStorage.getItem('firstName') || 'Jan',
        lastName: localStorage.getItem('lastName') || 'Kowalski',
        birthDate: localStorage.getItem('birthDate') || '01.01.1990',
        issueDate: localStorage.getItem('issueDate') || '01.01.2020'
    };
    
    // Generate unique code for this session
    const generatedCode = Math.random().toString(36).substring(2, 15);
    localStorage.setItem('generatedCode', generatedCode);
    localStorage.setItem('photo', 'assets/images/2137.jpg'); // Fallback photo
    
    // Store user data in localStorage for qrshowed.html
    Object.keys(userData).forEach(key => {
        localStorage.setItem(key, userData[key]);
    });
    
    const qrHTML = `
        <div class="qr-container">
            <div class="top_grid_fixed">
                <div class="action_grid_fixed">
                    <p onclick="location.reload()" class="back_text_fixed">Wróć</p>
                </div>
                <p class="title_text_fixed">Twój kod QR</p>
            </div>
            
            <div class="qr-content">
                <div class="qr-info">
                    <h3>Pokaż ten kod do zweryfikowania</h3>
                    <p class="qr-description">Kod jest ważny przez 5 minut</p>
                </div>
                
                <div class="qr-code-container">
                    <div id="qr-code" style="display: flex; justify-content: center; margin: 20px 0;"></div>
                </div>
                
                <div class="user-info">
                    <p><strong>Imię i nazwisko:</strong> ${userData.firstName} ${userData.lastName}</p>
                    <p><strong>PESEL:</strong> ${userData.pesel}</p>
                    <p><strong>Data urodzenia:</strong> ${userData.birthDate}</p>
                </div>
                
                <div class="qr-actions">
                    <button class="main_button" onclick="refreshQRCode()">Odśwież kod</button>
                </div>
            </div>
        </div>
    `;
    
    container.innerHTML = qrHTML;
    
    // Generate QR code
    if (typeof QRCode !== 'undefined') {
        const qrCodeURL = `${window.location.origin}/qrshowed.html?code=${generatedCode}`;
        
        new QRCode(document.getElementById("qr-code"), {
            text: qrCodeURL,
            width: 200,
            height: 200,
            colorDark: "#000000",
            colorLight: "#ffffff"
        });
    } else {
        document.getElementById("qr-code").innerHTML = '<p>Błąd: Biblioteka QR Code nie została załadowana</p>';
    }
    
    // Auto-refresh after 5 minutes
    setTimeout(() => {
        if (document.querySelector('.qr-container')) {
            refreshQRCode();
        }
    }, 5 * 60 * 1000);
}

function refreshQRCode() {
    showQRCode();
}

function handleScannedCode(code) {
    const container = document.querySelector('.container');
    
    // Check if it's a valid mObywatel QR code
    if (code.includes('/qrshowed.html?code=')) {
        // Redirect to the scanned URL
        window.location.href = code;
    } else {
        // Show generic scanned result
        const resultHTML = `
            <div class="scan-result">
                <div class="top_grid_fixed">
                    <div class="action_grid_fixed">
                        <p onclick="location.reload()" class="back_text_fixed">Wróć</p>
                    </div>
                    <p class="title_text_fixed">Wynik skanowania</p>
                </div>
                
                <div class="result-content">
                    <h3>Zeskanowano kod QR</h3>
                    <div class="scanned-data">
                        <p><strong>Zawartość:</strong></p>
                        <p class="code-content">${code}</p>
                    </div>
                    
                    <div class="result-actions">
                        <button class="main_button" onclick="location.reload()">Skanuj ponownie</button>
                        ${code.startsWith('http') ? `<button class="main_button" onclick="window.open('${code}', '_blank')">Otwórz link</button>` : ''}
                    </div>
                </div>
            </div>
        `;
        
        container.innerHTML = resultHTML;
    }
}

// Add CSS styles for QR functionality
const qrStyles = `
    .scanner-container, .qr-container, .scan-result {
        padding: 80px 20px 20px 20px;
    }
    
    .scanner-content, .qr-content, .result-content {
        text-align: center;
    }
    
    .scanner-info, .qr-description {
        font-size: 16px;
        margin: 15px 0;
        color: #666;
    }
    
    .scanner-status {
        font-size: 14px;
        color: #333;
        margin-top: 10px;
    }
    
    .qr-info h3 {
        font-size: 20px;
        margin: 20px 0 10px 0;
        color: #333;
    }
    
    .qr-code-container {
        background: white;
        padding: 20px;
        border-radius: 10px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        margin: 20px 0;
    }
    
    .user-info {
        background: #f8f8f8;
        padding: 15px;
        border-radius: 8px;
        margin: 20px 0;
        text-align: left;
    }
    
    .user-info p {
        margin: 8px 0;
        font-size: 14px;
    }
    
    .qr-actions, .result-actions {
        margin-top: 30px;
    }
    
    .qr-actions button, .result-actions button {
        margin: 0 10px;
    }
    
    .scanned-data {
        background: #f0f0f0;
        padding: 15px;
        border-radius: 8px;
        margin: 20px 0;
    }
    
    .code-content {
        font-family: monospace;
        word-break: break-all;
        font-size: 12px;
        color: #333;
    }
    
    #qr-scanner {
        border-radius: 10px;
        overflow: hidden;
    }
`;

// Inject styles
const styleSheet = document.createElement("style");
styleSheet.textContent = qrStyles;
document.head.appendChild(styleSheet);