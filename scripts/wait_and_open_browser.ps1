# 等待服务端口就绪并自动在浏览器中打开页面
param(
    [string]$Url = "http://localhost:3100",
    [int]$Port = 3100,
    [int]$MaxWaitSeconds = 45
)

for ($i = 0; $i -lt $MaxWaitSeconds; $i++) {
    Start-Sleep -Seconds 1
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $asyncResult = $tcp.BeginConnect("127.0.0.1", $Port, $null, $null)
        $success = $asyncResult.AsyncWaitHandle.WaitOne(500, $false)
        if ($success -and $tcp.Connected) {
            $tcp.EndConnect($asyncResult)
            $tcp.Close()
            Start-Process $Url
            exit 0
        }
        $tcp.Close()
    } catch {
        # 端口尚未就绪，继续等待
    }
}

# 超时兜底打开浏览器
Start-Process $Url
