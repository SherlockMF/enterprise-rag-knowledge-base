# 检查指定端口是否已在监听
param([int]$Port = 3100)
try {
    $t = New-Object System.Net.Sockets.TcpClient
    $async = $t.BeginConnect("127.0.0.1", $Port, $null, $null)
    $ok = $async.AsyncWaitHandle.WaitOne(400, $false)
    if ($ok -and $t.Connected) {
        $t.EndConnect($async)
        $t.Close()
        exit 0
    }
    $t.Close()
    exit 1
} catch {
    exit 1
}
