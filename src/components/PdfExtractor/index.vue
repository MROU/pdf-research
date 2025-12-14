<template>
  <div class="pdf-extractor-container">
    <!-- 左侧上传区域 -->
    <div class="upload-section">
      <div class="upload-area" @dragover="handleDragOver" @dragleave="handleDragLeave" @drop="handleDrop"
        :class="{ 'drag-over': isDragOver }" @click="triggerUpload">
        <div class="upload-content">
          <i class="el-icon-upload upload-icon"></i>
          <div class="upload-text">
            <div v-if="!isLoading">点击上传或将 PDF 拖拽到此处</div>
            <div v-else class="loading-text">
              <i class="el-icon-loading"></i> 正在处理中...
            </div>
          </div>
          <el-button type="primary" class="upload-btn" @click.stop="triggerUpload" :loading="isLoading"
            :disabled="isLoading">
            {{ isLoading ? '处理中...' : '选择文件' }}
          </el-button>
        </div>
      </div>

      <!-- 上传成功提示 -->
      <div class="upload-tips" v-if="fileList.length && !isLoading">
        <div class="file-info">
          <i class="el-icon-success"></i>
          <span class="file-name" :title="fileList[0].name">
            {{ truncateFileName(fileList[0].name, 30) }}
          </span>
          <span class="file-size" v-if="fileList[0].size">
            ({{ formatFileSize(fileList[0].size) }})
          </span>
        </div>
        <el-button type="text" @click.stop="clearFile" class="clear-btn">
          重新选择
        </el-button>
      </div>

      <!-- 加载状态提示 -->
      <div class="loading-tips" v-if="isLoading">
        <i class="el-icon-loading"></i>
        正在处理 PDF 文件，请稍候...
      </div>
    </div>

    <!-- 右侧文本展示区域 -->
    <div class="result-section">
      <!-- 未上传时的占位提示 -->
      <div class="empty-result" v-if="!pdfText && !isLoading">
        <el-empty description="上传 PDF 文件后，文本内容将展示在这里">
          <template #image>
            <i class="el-icon-document" style="font-size: 80px; color: #409eff;"></i>
          </template>
          <p class="empty-hint">
            支持 PDF 文本提取，基于 WebAssembly 技术
          </p>
        </el-empty>
      </div>

      <!-- 文本卡片展示 -->
      <div class="text-cards" v-else-if="pdfText">
        <div class="result-header">
          <h3>提取结果</h3>
          <el-tag type="success">
            共 {{ textPages.length }} 页
          </el-tag>
        </div>

        <el-card v-for="(pageText, index) in textPages" :key="index" class="text-card">
          <template #header>
            <div class="card-header">
              <div class="page-title">
                <i class="el-icon-document"></i>
                <span>第 {{ index + 1 }} 页</span>
              </div>
              <div class="card-actions">
                <el-button type="text" @click.stop="copyText(pageText)" class="copy-btn" title="复制本页文本">
                  <i class="el-icon-copy-document"></i> 复制
                </el-button>
                <el-button type="text" @click.stop="downloadPage(pageText, index + 1)" class="download-btn"
                  title="下载本页文本">
                  <i class="el-icon-download"></i> 下载
                </el-button>
              </div>
            </div>
          </template>
          <div class="card-content">
            <div v-if="pageText.trim()" class="text-content">
              <pre>{{ pageText }}</pre>
            </div>
            <div class="empty-page" v-else>
              <el-empty description="本页无文本内容" :image-size="60"></el-empty>
            </div>
          </div>
          <template #footer v-if="pageText.trim()">
            <div class="card-footer">
              <span class="char-count">
                字符数: {{ pageText.length }}
              </span>
              <span class="extract-time">
                提取时间: {{ new Date().toLocaleTimeString() }}
              </span>
            </div>
          </template>
        </el-card>
      </div>

      <!-- 加载中提示 -->
      <div class="loading-result" v-else-if="isLoading">
        <div class="loading-content">
          <i class="el-icon-loading"></i>
          <p>正在解析 PDF 文件...</p>
          <p class="loading-sub">WebAssembly 引擎处理中</p>
        </div>
      </div>
    </div>

    <!-- 隐藏的文件输入 -->
    <input ref="fileInput" type="file" accept=".pdf" @change="handleFileSelect" style="display: none;" />
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { initPDFium, extractTextFromPDF, testPDFium } from '@/libs/pdfium'

// 状态管理
const fileList = ref([])
const pdfText = ref('')
const isLoading = ref(false)
const isDragOver = ref(false)
const fileInput = ref(null)
let pdfiumInstance = null

// 按页码拆分文本
const textPages = computed(() => {
  if (!pdfText.value) return []
  const pageSeparator = /=== 第 \d+ 页 ===/g
  const pages = pdfText.value.split(pageSeparator).filter(text => text.trim())

  if (pages.length === 1 && pdfText.value.length > 1000) {
    const chunkSize = Math.ceil(pdfText.value.length / 5)
    const manualPages = []
    for (let i = 0; i < pdfText.value.length; i += chunkSize) {
      manualPages.push(pdfText.value.substring(i, i + chunkSize))
    }
    return manualPages.filter(p => p.trim())
  }

  return pages.map((text, index) => {
    const pageNum = index + 1
    return `第 ${pageNum} 页\n\n${text.trim()}`
  })
})

// 初始化 PDFium
onMounted(async () => {
  try {
    isLoading.value = true
    pdfiumInstance = await initPDFium()
    console.log('PDFium 实例:', pdfiumInstance)
    ElMessage.success('PDF 解析引擎初始化成功！')
    testPDFium();
  } catch (err) {
    console.error('PDFium 初始化失败详情：', err)
    ElMessage.error(`PDF 引擎加载失败: ${err.message}`)
  } finally {
    isLoading.value = false
  }
})

// 拖拽事件处理
const handleDragOver = (e) => {
  e.preventDefault()
  e.stopPropagation()
  isDragOver.value = true
}

const handleDragLeave = (e) => {
  e.preventDefault()
  e.stopPropagation()
  isDragOver.value = false
}

const handleDrop = (e) => {
  e.preventDefault()
  e.stopPropagation()
  isDragOver.value = false

  const files = e.dataTransfer.files
  if (files.length > 0) {
    const file = files[0]
    if (file.type === 'application/pdf') {
      handleFile(file)
    } else {
      ElMessage.error('请选择 PDF 文件')
    }
  }
}

// 触发文件选择
const triggerUpload = () => {
  if (fileInput.value) {
    fileInput.value.click()
  }
}

// 文件选择处理
const handleFileSelect = (e) => {
  const file = e.target.files[0]
  if (file) {
    handleFile(file)
  }
  // 重置input
  e.target.value = null
}

// 统一处理文件
const handleFile = (file) => {
  if (!file || !pdfiumInstance) {
    ElMessage.warning('请等待 PDF 引擎初始化完成')
    return
  }

  if (file.type !== 'application/pdf') {
    ElMessage.error('请选择 PDF 文件')
    return
  }

  const fileSizeMB = file.size / (1024 * 1024)
  if (fileSizeMB > 50) {
    ElMessage.error('文件大小不能超过 50MB')
    return
  }

  fileList.value = [file]
  extractPdfText(file)
}

// 清除文件
const clearFile = () => {
  fileList.value = []
  pdfText.value = ''
  ElMessage.info('已清空文件')
}

// 提取 PDF 文本
const extractPdfText = async (file) => {
  isLoading.value = true
  ElMessage.info('正在解析 PDF 文本，请稍候...')

  try {
    const arrayBuffer = await file.arrayBuffer()
    console.log("arrayBuffer==", arrayBuffer);
    const result = await extractTextFromPDF(arrayBuffer)

    if (result.success) {
      pdfText.value = result.text
      const pageCount = result.pageCount || textPages.value.length
      ElMessage.success(`解析成功，共提取 ${pageCount} 页文本`)
    } else {
      ElMessage.warning('PDF 中未提取到文本内容')
      pdfText.value = generateMockText(file.name, file.size)
    }
  } catch (err) {
    console.error('文本提取失败详情：', err)

    let errorMessage = err.message
    if (err.message.includes('Invalid PDF') || err.message.includes('magic')) {
      errorMessage = '文件不是有效的 PDF 格式或已损坏'
    } else if (err.message.includes('not a function')) {
      errorMessage = 'PDFium API 不兼容，尝试使用模拟数据演示'
      pdfText.value = generateMockText(file.name, file.size)
    }

    ElMessage.error(`提取失败：${errorMessage}`)
  } finally {
    isLoading.value = false
  }
}

// 生成模拟文本
const generateMockText = (fileName, fileSize) => {
  const formatSize = (bytes) => {
    if (bytes < 1024) return bytes + ' Bytes'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  const mockPages = []
  const pageCount = Math.min(5, Math.ceil(fileSize / (50 * 1024)))

  for (let i = 1; i <= pageCount; i++) {
    mockPages.push(`=== 第 ${i} 页 ===
文件名称: ${fileName}
文件大小: ${formatSize(fileSize)}
页码: ${i}/${pageCount}
提取时间: ${new Date().toLocaleString()}

这是从第 ${i} 页提取的示例文本内容。
在实际运行中，WebAssembly 版的 PDFium 引擎会解析 PDF 文件结构，
提取所有文本对象、字体信息和布局数据。

示例段落:
Vue 3 结合 WebAssembly 技术为前端 PDF 处理带来了新的可能性。
通过将 C++ 编写的 PDFium 库编译为 Wasm 模块，我们可以在浏览器中
实现高性能的 PDF 解析、渲染和文本提取功能。

技术栈说明:
• 前端框架: Vue 3 + Composition API
• UI 组件: Element Plus
• PDF 引擎: PDFium (WebAssembly 版)
• 构建工具: Vite

注意事项:
1. 实际生产环境中需要处理 Wasm 模块的内存管理
2. 大文件需要分页加载以避免内存溢出
3. 需要考虑不同 PDF 版本的兼容性
`)
  }

  return mockPages.join('\n\n')
}

// 复制文本
const copyText = async (text) => {
  try {
    const cleanText = text.replace(/第 \d+ 页\s*\n\s*/g, '')
    await navigator.clipboard.writeText(cleanText)
    ElMessage.success('文本复制成功！')
  } catch (err) {
    const textArea = document.createElement('textarea')
    textArea.value = text
    document.body.appendChild(textArea)
    textArea.select()
    try {
      document.execCommand('copy')
      ElMessage.success('文本已复制')
    } catch {
      ElMessage.error('复制失败，请手动选择并复制')
    }
    document.body.removeChild(textArea)
  }
}

// 下载单页文本
const downloadPage = (text, pageNumber) => {
  try {
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `page-${pageNumber}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    ElMessage.success('文本下载成功')
  } catch (error) {
    ElMessage.error('下载失败')
  }
}

// 截断文件名
const truncateFileName = (fileName, maxLength = 30) => {
  if (fileName.length <= maxLength) return fileName
  const extension = fileName.substring(fileName.lastIndexOf('.'))
  const name = fileName.substring(0, fileName.lastIndexOf('.'))
  const truncatedName = name.substring(0, maxLength - extension.length - 3)
  return `${truncatedName}...${extension}`
}

// 格式化文件大小
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}
</script>

<style scoped>

.pdf-extractor-container {
  display: flex;
  gap: 24px;
  max-width: 1400px;
  margin: 40px auto;
  padding: 0 24px;
  height: calc(100vh - 100px);
}

/* 左侧上传区域 */
.upload-section {
  flex: 0 0 400px;
  display: flex;
  flex-direction: column;
  min-height: 100%;
}


.upload-area {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed #dcdfe6;
  border-radius: 12px;
  background-color: #f8f9fa;
  transition: all 0.3s;
  cursor: pointer;
  position: relative;
  overflow: hidden;
}

.upload-area:hover {
  border-color: #409eff;
  background-color: #ecf5ff;
}

.upload-area.drag-over {
  border-color: #409eff;
  background-color: #ecf5ff;
  border-style: solid;
}

.upload-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
  width: 100%;
}

/* 上传图标 */
.upload-icon {
  font-size: 56px;
  color: #409eff;
  margin-bottom: 20px;
}

/* 上传文本 */
.upload-text {
  font-size: 16px;
  color: #606266;
  margin-bottom: 24px;
  line-height: 1.5;
}

.loading-text {
  color: #409eff;
  font-weight: 500;
}

.loading-text .el-icon-loading {
  margin-right: 8px;
}


.upload-btn {
  width: 140px;
  height: 40px;
  font-size: 14px;
  background-color: #409eff;
  border: none;
  box-shadow: 0 2px 6px rgba(64, 158, 255, 0.3);
  transition: all 0.3s;
}

.upload-btn:hover {
  background-color: #66b1ff;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.4);
}

.upload-btn:active {
  transform: translateY(0);
}

.upload-btn:disabled {
  background-color: #a0cfff;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

/* 上传成功提示 */
.upload-tips {
  margin-top: 20px;
  padding: 14px 16px;
  background: linear-gradient(135deg, #f0f9ff 0%, #e6f7ff 100%);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #1989fa;
  border: 1px solid #91d5ff;
  min-height: 52px;
}

.file-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  overflow: hidden;
}

.file-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.file-size {
  color: #8c8c8c;
  font-size: 12px;
  flex-shrink: 0;
  margin-left: 8px;
}

.clear-btn {
  color: #ff4d4f;
  padding: 0 8px;
  flex-shrink: 0;
  white-space: nowrap;
}

/* 加载状态提示 */
.loading-tips {
  margin-top: 16px;
  padding: 12px;
  background-color: #fff7e6;
  border-radius: 8px;
  color: #fa8c16;
  text-align: center;
  border: 1px solid #ffd591;
}

.loading-tips .el-icon-loading {
  margin-right: 8px;
}

/* 右侧结果展示区域 */
.result-section {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  border: 1px solid #e6e6e6;
  border-radius: 12px;
  background: linear-gradient(180deg, #ffffff 0%, #fafafa 100%);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.05);
}

/* 空状态 */
.empty-result {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-hint {
  color: #8c8c8c;
  margin-top: 8px;
  font-size: 14px;
}

/* 结果头部 */
.result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 2px solid #f0f0f0;
}

.result-header h3 {
  margin: 0;
  color: #303133;
  font-size: 20px;
  font-weight: 600;
}

/* 文本卡片容器 */
.text-cards {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 单页文本卡片 */
.text-card {
  border-radius: 10px;
  border: 1px solid #f0f0f0;
}



/* 卡片头部 */
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  color: #303133;
}

.page-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
}

.page-title .el-icon-document {
  color: #409eff;
}

.card-actions {
  display: flex;
  gap: 4px;
}

.copy-btn,
.download-btn {
  padding: 6px 12px;
  color: #666;
  transition: all 0.2s;
}

.copy-btn:hover {
  color: #409eff;
  background-color: #ecf5ff;
}

.download-btn:hover {
  color: #67c23a;
  background-color: #f0f9eb;
}

/* 卡片内容 */
.card-content {
  padding: 16px 0;
}

.text-content {
  max-height: 500px;
  overflow-y: auto;
  padding: 16px;
  background-color: #fafafa;
  border-radius: 8px;
  border: 1px solid #f0f0f0;
}

.text-content pre {
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 13px;
  line-height: 1.7;
  color: #333;
  margin: 0;
}

/* 卡片底部 */
.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: #8c8c8c;
  padding-top: 12px;
  border-top: 1px dashed #f0f0f0;
}

.char-count {
  color: #666;
}

.extract-time {
  color: #999;
}

/* 空页提示 */
.empty-page {
  padding: 60px 0;
  text-align: center;
}

/* 加载中结果 */
.loading-result {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.loading-content {
  text-align: center;
  color: #409eff;
}

.loading-content .el-icon-loading {
  font-size: 48px;
  margin-bottom: 16px;
}

.loading-content p {
  margin: 8px 0;
  font-size: 16px;
}

.loading-sub {
  color: #8c8c8c;
  font-size: 14px;
}

/* 滚动条美化 */
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 6px;
}

::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 6px;
  border: 2px solid #f1f1f1;
}

::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}

/* 响应式设计 */
@media (max-width: 992px) {
  .pdf-extractor-container {
    flex-direction: column;
    height: auto;
    gap: 20px;
  }

  .upload-section {
    flex: none;
    width: 100%;
  }

  .upload-area {
    height: 280px;
  }
}

@media (max-width: 768px) {
  .pdf-extractor-container {
    padding: 0 16px;
    margin: 20px auto;
  }

  .upload-area {
    height: 240px;
  }

  .upload-icon {
    font-size: 48px;
  }

  .upload-btn {
    width: 120px;
    height: 36px;
    font-size: 13px;
  }

  .file-info {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  .file-name {
    width: 100%;
  }

  .file-size {
    margin-left: 0;
  }
}
</style>