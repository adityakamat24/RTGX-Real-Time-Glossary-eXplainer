# PowerShell script to start all Context Subtitles services
Write-Host "Starting Context Subtitles Application..." -ForegroundColor Green
Write-Host ""

# Set CUDA path
$env:PATH = "C:\Program Files\NVIDIA\CUDNN\v9.13\bin\12.9;" + $env:PATH

# Change to project directory
$projectRoot = "D:\cse_518_project\context-subtitles"
Set-Location $projectRoot

# Define services
$services = @()

try {
    # Start Server
    Write-Host "Starting Server..." -ForegroundColor Yellow
    $serverProcess = Start-Process -FilePath "cmd" -ArgumentList "/c", "cd /d $projectRoot\server && node index.js" -PassThru -WindowStyle Normal
    $services += $serverProcess
    Start-Sleep -Seconds 2

    # Start ASR Service
    Write-Host "Starting ASR Service..." -ForegroundColor Yellow
    $asrProcess = Start-Process -FilePath "cmd" -ArgumentList "/c", "cd /d $projectRoot\asr && .\.venv\Scripts\activate && python stream.py --model medium --lang en --beam 3 --rms-thresh 0.0025 --silence-hold 300 --vad-threshold 0.45" -PassThru -WindowStyle Normal
    $services += $asrProcess
    Start-Sleep -Seconds 3

    # Start Client
    Write-Host "Starting Client..." -ForegroundColor Yellow
    $clientProcess = Start-Process -FilePath "cmd" -ArgumentList "/c", "cd /d $projectRoot\client && npm run dev -- --host" -PassThru -WindowStyle Normal
    $services += $clientProcess
    Start-Sleep -Seconds 2

    Write-Host ""
    Write-Host "All services started successfully!" -ForegroundColor Green
    Write-Host "Server: http://localhost:3000" -ForegroundColor Cyan
    Write-Host "Client: http://localhost:5173" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Press Ctrl+C to stop all services..." -ForegroundColor White

    # Wait for user to press Ctrl+C
    while ($true) {
        Start-Sleep -Seconds 1
        
        # Check if any service has exited
        $runningServices = $services | Where-Object { !$_.HasExited }
        if ($runningServices.Count -eq 0) {
            Write-Host "All services have stopped." -ForegroundColor Red
            break
        }
    }
}
catch {
    Write-Host "Error starting services: $($_.Exception.Message)" -ForegroundColor Red
}
finally {
    # Clean up: Kill all spawned processes
    Write-Host ""
    Write-Host "Stopping all services..." -ForegroundColor Yellow
    
    foreach ($service in $services) {
        if (!$service.HasExited) {
            try {
                $service.Kill()
                $service.WaitForExit(5000)
            }
            catch {
                Write-Host "Could not stop service with PID $($service.Id)" -ForegroundColor Red
            }
        }
    }
    
    # Additional cleanup - kill any remaining node/python processes that might be related
    try {
        Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match "(Server|Client)" } | Stop-Process -Force
        Get-Process -Name "python" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match "stream.py" } | Stop-Process -Force
    }
    catch {
        # Ignore cleanup errors
    }
    
    Write-Host "All services stopped." -ForegroundColor Green
}