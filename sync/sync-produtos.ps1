# ============================================================
# Sincronizacao CES -> Site S&A Distribuidora Automotiva
# Roda diariamente: exporta estoque + produtos novos do Oracle
# e envia para o site via API segura.
# ============================================================

# ---- CONFIGURACAO ----
$SyncUrl = "https://seadistribuidora.com.br/.netlify/functions/sync"
$SyncKey = $env:SA_SYNC_KEY   # mesma chave configurada no Netlify - definir como variavel de ambiente da maquina/tarefa agendada
$LogFile = "C:\ces\catalogo-sa\sync\sync-log.txt"
$ScratchDir = "$env:TEMP\sa-sync"

if ([string]::IsNullOrEmpty($SyncKey)) {
    Write-Host "Defina a variavel de ambiente SA_SYNC_KEY antes de rodar"
    exit 1
}

# ---- PREPARACAO ----
New-Item -ItemType Directory -Force -Path $ScratchDir | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null
$dataHora = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"[$dataHora] Iniciando sincronizacao..." | Out-File -Append $LogFile

try {
    # ---- 1. Exportar dados do Oracle via sqlplus ----
    $sqlFile = "$ScratchDir\export_sync.sql"
    $outFile = "$ScratchDir\export_sync.txt"

    @"
SET HEADING OFF
SET PAGESIZE 0
SET LINESIZE 32767
SET LONG 500000
SET FEEDBACK OFF
SET TRIMSPOOL ON
SET TRIM ON
SET WRAP OFF
SET DEFINE OFF
SPOOL $outFile
SELECT JSON_OBJECT(
    'id' VALUE p.PRODUTO_ID,
    'nome' VALUE p.NOME_PRODUTO,
    'sku' VALUE NVL(p.CODIGO_ORIGINAL, NVL(p.CODIGO_FABRICA, 'PRD-' || p.PRODUTO_ID)),
    'categoria' VALUE NVL(g.DESCRICAO, 'Geral'),
    'marca' VALUE NVL(m.DESCRICAO, 'Diversos'),
    'preco' VALUE NVL(p.CUSTO_VENDA, 0),
    'estoque' VALUE NVL(e.ESTOQUE_ATUAL, 0)
)
FROM PRODUTOS p
LEFT JOIN ESTOQUES e ON e.PRODUTO_ID = p.PRODUTO_ID
LEFT JOIN GRUPOS g ON g.GRUPO_ID = p.GRUPO_ID
LEFT JOIN MARCAS m ON m.MARCA_ID = p.MARCA_ID
WHERE p.ATIVO = 'S' AND p.DESCONTINUADO = 'N' AND p.PRODUTO_ID > 0;
SPOOL OFF
EXIT
"@ | Out-File -Encoding ASCII $sqlFile

    sqlplus -S ADMIN/MANAGER@MASTER "@$sqlFile" | Out-Null

    if (-not (Test-Path $outFile)) {
        throw "Export do Oracle falhou - arquivo nao gerado"
    }

    # ---- 2. Montar array JSON valido a partir das linhas ----
    $linhas = Get-Content $outFile | Where-Object { $_.Trim() -ne "" }
    $jsonArray = "[" + ($linhas -join ",") + "]"

    # Valida se é JSON parseavel antes de enviar
    $produtos = $jsonArray | ConvertFrom-Json
    $totalProdutos = $produtos.Count

    "[$dataHora] Exportados $totalProdutos produtos do Oracle." | Out-File -Append $LogFile

    if ($totalProdutos -eq 0) {
        throw "Nenhum produto exportado - abortando envio por seguranca"
    }

    # ---- 3. Enviar para o site em lotes de 500 ----
    $lote = 500
    $totalAtualizados = 0
    $totalNovos = 0

    for ($i = 0; $i -lt $produtos.Count; $i += $lote) {
        $fim = [Math]::Min($i + $lote, $produtos.Count) - 1
        $pedaco = $produtos[$i..$fim]
        $payload = @{ produtos = $pedaco } | ConvertTo-Json -Depth 5 -Compress

        $resposta = Invoke-RestMethod -Uri $SyncUrl -Method Post -Headers @{ "X-Sync-Key" = $SyncKey } -ContentType "application/json" -Body $payload

        $totalAtualizados += $resposta.atualizados
        $totalNovos += $resposta.novos
    }

    "[$dataHora] Sincronizacao concluida: $totalAtualizados atualizados, $totalNovos novos." | Out-File -Append $LogFile
    Write-Host "Sincronizacao concluida com sucesso: $totalAtualizados atualizados, $totalNovos novos produtos."
}
catch {
    $erro = $_.Exception.Message
    "[$dataHora] ERRO: $erro" | Out-File -Append $LogFile
    Write-Host "ERRO na sincronizacao: $erro"
    exit 1
}
finally {
    Remove-Item -Recurse -Force $ScratchDir -ErrorAction SilentlyContinue
}
