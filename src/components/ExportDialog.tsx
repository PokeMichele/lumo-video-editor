import { useState, useEffect, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Download, CheckCircle, X, AlertCircle, Cpu, HardDrive } from "lucide-react";
import { TimelineItem } from "./VideoEditor";

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  timelineItems: TimelineItem[];
  totalDuration: number;
  aspectRatio: '16:9' | '4:3' | '9:16';
  selectedFPS: 24 | 30 | 60;
  trackVolumes: Map<string, number>;
}

interface WorkerMessage {
  type: 'init' | 'render-frame' | 'progress' | 'complete' | 'error';
  payload?: any;
}

interface ExportStats {
  framesRendered: number;
  framesTotal: number;
  avgFrameTime: number;
  memoryUsage: number;
  renderingSpeed: number;
}

// Web Worker per rendering offscreen
const createRenderWorker = () => {
  const workerScript = `
    class RenderWorker {
      constructor() {
        this.canvas = null;
        this.ctx = null;
        this.mediaCache = new Map();
        this.isRendering = false;
      }

      async init(canvasWidth, canvasHeight) {
        try {
          this.canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
          this.ctx = this.canvas.getContext('2d');
          
          if (!this.ctx) {
            throw new Error('Failed to get canvas context');
          }
          
          // Ottimizzazioni canvas
          this.ctx.imageSmoothingEnabled = true;
          this.ctx.imageSmoothingQuality = 'high';
          
          self.postMessage({ type: 'init', payload: { success: true } });
        } catch (error) {
          self.postMessage({ type: 'error', payload: { message: error.message } });
        }
      }

      async loadMedia(mediaData) {
        const promises = mediaData.map(async (item) => {
          try {
            if (item.type === 'video') {
              const video = new OffscreenVideo();
              video.src = item.url;
              await video.load();
              this.mediaCache.set(item.id, video);
            } else if (item.type === 'image') {
              const response = await fetch(item.url);
              const blob = await response.blob();
              const bitmap = await createImageBitmap(blob);
              this.mediaCache.set(item.id, bitmap);
            }
          } catch (error) {
            console.warn('Failed to load media:', item.id, error);
          }
        });
        
        await Promise.all(promises);
      }

      async renderFrame(frameData) {
        if (!this.ctx || !this.canvas) return;
        
        const startTime = performance.now();
        
        // Clear canvas
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Apply global effects
        this.ctx.save();
        this.ctx.globalAlpha = frameData.globalAlpha || 1.0;
        
        let filterString = 'none';
        const filters = [];
        
        if (frameData.blackWhite) {
          filters.push('grayscale(1)');
        }
        
        if (frameData.blurIntensity > 0) {
          filters.push(\`blur(\${frameData.blurIntensity}px)\`);
        }
        
        if (filters.length > 0) {
          filterString = filters.join(' ');
        }
        
        this.ctx.filter = filterString;
        
        // Apply zoom transformation
        if (frameData.zoomScale !== 1.0) {
          const centerX = this.canvas.width / 2;
          const centerY = this.canvas.height / 2;
          
          this.ctx.translate(centerX, centerY);
          this.ctx.scale(frameData.zoomScale, frameData.zoomScale);
          this.ctx.translate(-centerX, -centerY);
        }
        
        // Render media items
        for (const item of frameData.activeItems) {
          const media = this.mediaCache.get(item.id);
          if (!media) continue;
          
          try {
            if (item.type === 'video') {
              await this.renderVideo(media, item, frameData.time);
            } else if (item.type === 'image') {
              this.renderImage(media, item);
            }
          } catch (error) {
            console.warn('Error rendering item:', item.id, error);
          }
        }
        
        this.ctx.restore();
        
        // Convert to ImageData and transfer
        const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const renderTime = performance.now() - startTime;
        
        self.postMessage({
          type: 'render-frame',
          payload: {
            imageData: imageData,
            renderTime: renderTime,
            frameIndex: frameData.frameIndex
          }
        }, [imageData.data.buffer]);
      }

      async renderVideo(video, item, currentTime) {
        const relativeTime = currentTime - item.startTime;
        const mediaOffset = item.mediaStartOffset || 0;
        const targetTime = relativeTime + mediaOffset;
        
        if (targetTime >= 0 && targetTime <= video.duration) {
          video.currentTime = targetTime;
          
          const videoAspect = video.videoWidth / video.videoHeight;
          const canvasAspect = this.canvas.width / this.canvas.height;
          
          let renderWidth, renderHeight, offsetX, offsetY;
          
          if (videoAspect > canvasAspect) {
            renderWidth = this.canvas.width;
            renderHeight = this.canvas.width / videoAspect;
            offsetX = 0;
            offsetY = (this.canvas.height - renderHeight) / 2;
          } else {
            renderWidth = this.canvas.height * videoAspect;
            renderHeight = this.canvas.height;
            offsetX = (this.canvas.width - renderWidth) / 2;
            offsetY = 0;
          }
          
          const trackOffsetX = item.track * 5;
          const trackOffsetY = item.track * 5;
          
          this.ctx.drawImage(
            video,
            offsetX + trackOffsetX,
            offsetY + trackOffsetY,
            renderWidth - trackOffsetX * 2,
            renderHeight - trackOffsetY * 2
          );
        }
      }

      renderImage(bitmap, item) {
        const imgAspect = bitmap.width / bitmap.height;
        const canvasAspect = this.canvas.width / this.canvas.height;
        
        let renderWidth, renderHeight, offsetX, offsetY;
        
        if (imgAspect > canvasAspect) {
          renderWidth = this.canvas.width * 0.9;
          renderHeight = renderWidth / imgAspect;
          offsetX = (this.canvas.width - renderWidth) / 2;
          offsetY = (this.canvas.height - renderHeight) / 2;
        } else {
          renderHeight = this.canvas.height * 0.9;
          renderWidth = renderHeight * imgAspect;
          offsetX = (this.canvas.width - renderWidth) / 2;
          offsetY = (this.canvas.height - renderHeight) / 2;
        }
        
        const trackOffsetX = item.track * 10;
        const trackOffsetY = item.track * 10;
        
        this.ctx.drawImage(
          bitmap,
          offsetX + trackOffsetX,
          offsetY + trackOffsetY,
          renderWidth - trackOffsetX,
          renderHeight - trackOffsetY
        );
      }
    }

    const worker = new RenderWorker();

    self.onmessage = async function(e) {
      const { type, payload } = e.data;
      
      switch (type) {
        case 'init':
          await worker.init(payload.width, payload.height);
          break;
        case 'load-media':
          await worker.loadMedia(payload.mediaData);
          break;
        case 'render-frame':
          await worker.renderFrame(payload);
          break;
      }
    };
  `;

  const blob = new Blob([workerScript], { type: 'application/javascript' });
  return new Worker(URL.createObjectURL(blob));
};

export const ExportDialog = ({ 
  isOpen, 
  onClose, 
  timelineItems, 
  totalDuration, 
  aspectRatio,
  selectedFPS,
  trackVolumes 
}: ExportDialogProps) => {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'preparing' | 'rendering' | 'encoding' | 'completed' | 'error'>('preparing');
  const [exportStats, setExportStats] = useState<ExportStats>({
    framesRendered: 0,
    framesTotal: 0,
    avgFrameTime: 0,
    memoryUsage: 0,
    renderingSpeed: 0
  });
  const [estimatedTime, setEstimatedTime] = useState<string>('');
  const [qualityMode, setQualityMode] = useState<'fast' | 'balanced' | 'high'>('balanced');
  
  // Refs per gestione risorse
  const workerRef = useRef<Worker | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef<boolean>(false);
  const renderingRef = useRef<boolean>(false);
  const frameQueueRef = useRef<ImageData[]>([]);
  const performanceRef = useRef({
    startTime: 0,
    frameCount: 0,
    totalRenderTime: 0,
    lastProgressUpdate: 0
  });

  // Memory monitoring
  const monitorMemoryUsage = useCallback(() => {
    if ('memory' in performance) {
      const memInfo = (performance as any).memory;
      const usedMB = memInfo.usedJSHeapSize / 1024 / 1024;
      
      setExportStats(prev => ({
        ...prev,
        memoryUsage: usedMB
      }));
      
      // Garbage collection hint se necessario
      if (usedMB > 500) { // 500MB threshold
        if ('gc' in window) {
          (window as any).gc();
        }
      }
    }
  }, []);

  // Calculate canvas dimensions ottimizzate per qualità
  const getCanvasDimensions = useCallback(() => {
    const qualityMultipliers = {
      'fast': 0.75,     // 1440p base
      'balanced': 1.0,  // 1920p base  
      'high': 1.25      // 2400p base
    };
    
    const baseWidth = 1920 * qualityMultipliers[qualityMode];
    
    switch (aspectRatio) {
      case '16:9':
        return { width: baseWidth, height: Math.round(baseWidth / (16/9)) };
      case '4:3':
        return { width: baseWidth, height: Math.round(baseWidth / (4/3)) };
      case '9:16':
        return { width: Math.round(baseWidth * (9/16)), height: baseWidth };
      default:
        return { width: baseWidth, height: Math.round(baseWidth / (16/9)) };
    }
  }, [aspectRatio, qualityMode]);

  // Batch frame processing per performance migliori
  const processBatchFrames = useCallback(async (
    startFrame: number, 
    endFrame: number, 
    fps: number,
    dimensions: { width: number; height: number }
  ) => {
    if (!workerRef.current || cancelledRef.current) return [];
    
    const batchSize = qualityMode === 'fast' ? 10 : qualityMode === 'balanced' ? 8 : 5;
    const results: ImageData[] = [];
    
    for (let i = startFrame; i < endFrame && i < startFrame + batchSize; i++) {
      if (cancelledRef.current) break;
      
      const currentTime = i / fps;
      const frameData = prepareFrameData(currentTime, i);
      
      // Send render request to worker
      const promise = new Promise<ImageData>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Frame render timeout'));
        }, 5000);
        
        const handleMessage = (e: MessageEvent<WorkerMessage>) => {
          if (e.data.type === 'render-frame' && e.data.payload.frameIndex === i) {
            clearTimeout(timeout);
            workerRef.current?.removeEventListener('message', handleMessage);
            resolve(e.data.payload.imageData);
          }
        };
        
        workerRef.current?.addEventListener('message', handleMessage);
        workerRef.current?.postMessage({
          type: 'render-frame',
          payload: frameData
        });
      });
      
      try {
        const imageData = await promise;
        results.push(imageData);
        
        // Aggiorna stats
        const perf = performanceRef.current;
        perf.frameCount++;
        
        const now = performance.now();
        if (now - perf.lastProgressUpdate > 100) { // Update ogni 100ms
          const progressPercent = (perf.frameCount / exportStats.framesTotal) * 100;
          setProgress(progressPercent);
          
          const renderingSpeed = perf.frameCount / ((now - perf.startTime) / 1000);
          setExportStats(prev => ({
            ...prev,
            framesRendered: perf.frameCount,
            renderingSpeed: renderingSpeed
          }));
          
          perf.lastProgressUpdate = now;
        }
        
      } catch (error) {
        console.warn(`Failed to render frame ${i}:`, error);
      }
    }
    
    return results;
  }, [qualityMode, exportStats.framesTotal]);

  // Prepara dati per frame
  const prepareFrameData = useCallback((time: number, frameIndex: number) => {
    const activeItems = timelineItems.filter(item =>
      item.mediaFile.type !== 'effect' &&
      time >= item.startTime && 
      time < item.startTime + item.duration
    ).sort((a, b) => a.track - b.track);

    // Calcola effetti
    const globalAlpha = calculateGlobalAlpha(time);
    const blackWhite = isBlackWhiteActive(time);
    const zoomScale = calculateZoomScale(time);
    const blurIntensity = calculateBlurIntensity(time);

    return {
      time,
      frameIndex,
      activeItems: activeItems.map(item => ({
        id: item.id,
        type: item.mediaFile.type,
        startTime: item.startTime,
        duration: item.duration,
        track: item.track,
        mediaStartOffset: item.mediaStartOffset
      })),
      globalAlpha,
      blackWhite,
      zoomScale,
      blurIntensity
    };
  }, [timelineItems]);

  // Funzioni di calcolo effetti (ottimizzate)
  const calculateGlobalAlpha = useCallback((time: number) => {
    const activeEffects = timelineItems.filter(item =>
      item.mediaFile.type === 'effect' &&
      time >= item.startTime &&
      time < item.startTime + item.duration
    );

    let globalAlpha = 1.0;

    for (const effect of activeEffects) {
      if (!effect.mediaFile.effectType) continue;

      const relativeTime = time - effect.startTime;
      const progress = relativeTime / effect.duration;

      switch (effect.mediaFile.effectType) {
        case 'fade-in':
          globalAlpha *= Math.min(progress, 1);
          break;
        case 'fade-out':
          globalAlpha *= Math.max(1 - progress, 0);
          break;
      }
    }

    return Math.max(0, Math.min(1, globalAlpha));
  }, [timelineItems]);

  const isBlackWhiteActive = useCallback((time: number) => {
    return timelineItems.some(item =>
      item.mediaFile.type === 'effect' &&
      item.mediaFile.effectType === 'black-white' &&
      time >= item.startTime &&
      time < item.startTime + item.duration
    );
  }, [timelineItems]);

  const calculateBlurIntensity = useCallback((time: number) => {
    const activeBlurEffects = timelineItems.filter(item =>
      item.mediaFile.type === 'effect' &&
      item.mediaFile.effectType === 'blur' &&
      time >= item.startTime &&
      time < item.startTime + item.duration
    );

    let blurIntensity = 0;

    for (const effect of activeBlurEffects) {
      const relativeTime = time - effect.startTime;
      const progress = relativeTime / effect.duration;
      const effectIntensity = effect.mediaFile.effectIntensity || 50;
      const currentBlur = (effectIntensity / 100) * 10;
      blurIntensity = Math.max(blurIntensity, currentBlur);
    }

    return Math.max(0, Math.min(10, blurIntensity));
  }, [timelineItems]);

  const calculateZoomScale = useCallback((time: number) => {
    const activeZoomEffects = timelineItems.filter(item =>
      item.mediaFile.type === 'effect' &&
      (item.mediaFile.effectType === 'zoom-in' || item.mediaFile.effectType === 'zoom-out') &&
      time >= item.startTime &&
      time < item.startTime + item.duration
    );

    let zoomScale = 1.0;

    for (const effect of activeZoomEffects) {
      const relativeTime = time - effect.startTime;
      const progress = relativeTime / effect.duration;
      const effectIntensity = effect.mediaFile.effectIntensity || 50;

      if (effect.mediaFile.effectType === 'zoom-in') {
        const maxZoomFactor = 1 + (effectIntensity / 100) * 2;
        const currentScale = 1 + (progress * (maxZoomFactor - 1));
        zoomScale *= currentScale;
      } else if (effect.mediaFile.effectType === 'zoom-out') {
        const minZoomFactor = 1 - (effectIntensity / 100) * 0.8;
        const currentScale = 1 - (progress * (1 - minZoomFactor));
        zoomScale *= currentScale;
      }
    }

    return Math.max(0.1, Math.min(5.0, zoomScale));
  }, [timelineItems]);

  // Setup audio context ottimizzato
  const setupAudioContext = useCallback(async () => {
    if (cancelledRef.current) return null;

    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 48000, // Alta qualità
        latencyHint: 'balanced'
      });
      
      const destination = audioContext.createMediaStreamDestination();
      const masterGain = audioContext.createGain();
      masterGain.gain.value = 1.0;
      masterGain.connect(destination);

      // Setup compressor per audio quality
      const compressor = audioContext.createDynamicsCompressor();
      compressor.threshold.value = -24;
      compressor.knee.value = 30;
      compressor.ratio.value = 12;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;
      
      masterGain.connect(compressor);
      compressor.connect(destination);

      audioContextRef.current = audioContext;
      return { audioContext, destination, masterGain };
    } catch (error) {
      console.error('Failed to setup audio context:', error);
      return null;
    }
  }, []);

  // Export process principale
  const exportVideo = useCallback(async () => {
    try {
      if (cancelledRef.current || renderingRef.current) return;

      renderingRef.current = true;
      setStatus('preparing');
      setProgress(0);

      const dimensions = getCanvasDimensions();
      const maxEndTime = Math.max(...timelineItems.map(item => item.startTime + item.duration), 1);
      const exportDuration = maxEndTime;
      const totalFrames = Math.ceil(exportDuration * selectedFPS);

      setExportStats(prev => ({
        ...prev,
        framesTotal: totalFrames,
        framesRendered: 0
      }));

      // Initialize worker
      workerRef.current = createRenderWorker();
      
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Worker init timeout')), 10000);
        
        const handleMessage = (e: MessageEvent<WorkerMessage>) => {
          if (e.data.type === 'init') {
            clearTimeout(timeout);
            workerRef.current?.removeEventListener('message', handleMessage);
            resolve();
          }
        };
        
        workerRef.current?.addEventListener('message', handleMessage);
        workerRef.current?.postMessage({
          type: 'init',
          payload: { width: dimensions.width, height: dimensions.height }
        });
      });

      // Load media into worker
      const mediaData = timelineItems
        .filter(item => item.mediaFile.type !== 'effect')
        .map(item => ({
          id: item.id,
          type: item.mediaFile.type,
          url: item.mediaFile.url
        }));

      workerRef.current.postMessage({
        type: 'load-media',
        payload: { mediaData }
      });

      setStatus('rendering');
      performanceRef.current.startTime = performance.now();

      // Setup canvas and recording
      const canvas = canvasRef.current!;
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      const ctx = canvas.getContext('2d')!;

      // Setup audio
      const audioSetup = await setupAudioContext();
      
      // Setup MediaRecorder con qualità ottimizzata
      const canvasStream = canvas.captureStream(selectedFPS);
      const audioStream = audioSetup?.destination?.stream;
      
      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...(audioStream?.getAudioTracks() || [])
      ]);

      const bitrates = {
        'fast': { video: 4000000, audio: 96000 },
        'balanced': { video: 8000000, audio: 128000 },
        'high': { video: 15000000, audio: 192000 }
      };

      const mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: 'video/webm;codecs=vp9,opus',
        videoBitsPerSecond: bitrates[qualityMode].video,
        audioBitsPerSecond: bitrates[qualityMode].audio
      });

      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && !cancelledRef.current) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        if (!cancelledRef.current) {
          setStatus('encoding');
          
          setTimeout(() => {
            const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);

            // Auto-download
            const link = document.createElement('a');
            link.href = url;
            link.download = `video-export-${aspectRatio}-${qualityMode}-${Date.now()}.webm`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            setStatus('completed');
            
            // Auto-close dopo 2 secondi
            setTimeout(() => {
              URL.revokeObjectURL(url);
              onClose();
            }, 2000);
          }, 500);
        }
      };

      mediaRecorder.start();

      // Batch rendering loop
      const batchSize = qualityMode === 'fast' ? 30 : qualityMode === 'balanced' ? 20 : 15;
      
      for (let frameStart = 0; frameStart < totalFrames; frameStart += batchSize) {
        if (cancelledRef.current) break;
        
        const frameEnd = Math.min(frameStart + batchSize, totalFrames);
        const batchFrames = await processBatchFrames(frameStart, frameEnd, selectedFPS, dimensions);
        
        // Render batch to canvas
        for (let i = 0; i < batchFrames.length; i++) {
          if (cancelledRef.current) break;
          
          const imageData = batchFrames[i];
          ctx.putImageData(imageData, 0, 0);
          
          // Small delay to allow MediaRecorder to capture
          await new Promise(resolve => setTimeout(resolve, 1000 / selectedFPS / 2));
        }
        
        // Memory cleanup ogni 100 frame
        if (frameStart % 100 === 0) {
          monitorMemoryUsage();
        }
      }

      if (!cancelledRef.current && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }

    } catch (error) {
      console.error('Export failed:', error);
      if (!cancelledRef.current) {
        renderingRef.current = false;
        setStatus('error');
      }
    }
  }, [timelineItems, aspectRatio, qualityMode, selectedFPS, getCanvasDimensions, setupAudioContext, processBatchFrames, monitorMemoryUsage]);

  // Cleanup completo
  const cleanupResources = useCallback(() => {
    cancelledRef.current = true;
    
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try {
        mediaRecorderRef.current.stop();
      } catch (error) {
        console.warn('Error stopping MediaRecorder:', error);
      }
    }
    
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (error) {
        console.warn('Error closing audio context:', error);
      }
      audioContextRef.current = null;
    }
    
    recordedChunksRef.current = [];
    renderingRef.current = false;
    frameQueueRef.current = [];
  }, []);

  // Effect per gestione dialog
  useEffect(() => {
    if (!isOpen) {
      cleanupResources();
      setProgress(0);
      setStatus('preparing');
      return;
    }

    cancelledRef.current = false;
    renderingRef.current = false;
    setProgress(0);
    setStatus('preparing');

    const startExport = setTimeout(() => {
      if (!cancelledRef.current && !renderingRef.current) {
        exportVideo();
      }
    }, 1000);

    return () => {
      clearTimeout(startExport);
    };
  }, [isOpen, exportVideo, cleanupResources]);

  // Handlers
  const handleCancel = useCallback(() => {
    cleanupResources();
    setProgress(0);
    setStatus('preparing');
  }, [cleanupResources]);

  const handleClose = useCallback(() => {
    if (status === 'preparing' || status === 'rendering') {
      handleCancel();
    } else {
      cleanupResources();
    }
    onClose();
  }, [status, handleCancel, cleanupResources, onClose]);

  const handleQualityChange = useCallback((newQuality: 'fast' | 'balanced' | 'high') => {
    if (status === 'preparing') {
      setQualityMode(newQuality);
    }
  }, [status]);

  // UI helpers
  const getStatusText = () => {
    if (cancelledRef.current) return 'Export cancelled';
    
    switch (status) {
      case 'preparing': return 'Initializing export engine...';
      case 'rendering': return `Rendering frames (${exportStats.framesRendered}/${exportStats.framesTotal})`;
      case 'encoding': return 'Finalizing video...';
      case 'completed': return 'Export completed successfully!';
      case 'error': return 'Export failed';
      default: return 'Processing...';
    }
  };

  const getStatusColor = () => {
    if (cancelledRef.current) return 'text-orange-500';
    
    switch (status) {
      case 'preparing': return 'text-blue-500';
      case 'rendering': return 'text-yellow-500';
      case 'encoding': return 'text-purple-500';
      case 'completed': return 'text-green-500';
      case 'error': return 'text-red-500';
      default: return 'text-gray-500';
    }
  };

  const getStatusIcon = () => {
    if (cancelledRef.current) return <AlertCircle className="w-5 h-5 text-orange-500" />;
    
    switch (status) {
      case 'rendering': return <Cpu className="w-5 h-5 text-yellow-500 animate-pulse" />;
      case 'encoding': return <HardDrive className="w-5 h-5 text-purple-500 animate-pulse" />;
      case 'completed': return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'error': return <X className="w-5 h-5 text-red-500" />;
      default: return null;
    }
  };

  return (
    <>
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="w-5 h-5" />
              High-Performance Video Export
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6">
            {/* Quality Selection */}
            {status === 'preparing' && (
              <div className="space-y-3">
                <label className="text-sm font-medium">Export Quality</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['fast', 'balanced', 'high'] as const).map((quality) => (
                    <Button
                      key={quality}
                      variant={qualityMode === quality ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleQualityChange(quality)}
                      className="text-xs"
                    >
                      {quality.charAt(0).toUpperCase() + quality.slice(1)}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Export Details */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Quality:</span>
                  <span className="font-medium">{qualityMode}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Aspect Ratio:</span>
                  <span className="font-medium">{aspectRatio}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Frame Rate:</span>
                  <span className="font-medium">{selectedFPS} fps</span>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Duration:</span>
                  <span className="font-medium">{Math.round(totalDuration)}s</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Items:</span>
                  <span className="font-medium">{timelineItems.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Frames:</span>
                  <span className="font-medium">{exportStats.framesTotal}</span>
                </div>
              </div>
            </div>

            {/* Progress Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className={`text-sm font-medium ${getStatusColor()}`}>
                  {getStatusText()}
                </span>
                {getStatusIcon()}
              </div>
              
              <Progress value={progress} className="w-full h-3" />
              
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{progress.toFixed(1)}% completed</span>
                {status === 'rendering' && exportStats.renderingSpeed > 0 && (
                  <span>{exportStats.renderingSpeed.toFixed(1)} fps rendering</span>
                )}
              </div>
            </div>

            {/* Performance Stats */}
            {status === 'rendering' && (
              <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                <div className="text-xs font-medium text-muted-foreground mb-2">Performance</div>
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div className="flex justify-between">
                    <span>Rendered:</span>
                    <span>{exportStats.framesRendered}/{exportStats.framesTotal}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Speed:</span>
                    <span>{exportStats.renderingSpeed.toFixed(1)} fps</span>
                  </div>
                  {exportStats.memoryUsage > 0 && (
                    <>
                      <div className="flex justify-between">
                        <span>Memory:</span>
                        <span>{exportStats.memoryUsage.toFixed(1)} MB</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Engine:</span>
                        <span>Web Workers</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end gap-2">
              <Button
                onClick={handleClose}
                variant={status === 'completed' ? 'default' : 'outline'}
                size="sm"
              >
                {status === 'preparing' || status === 'rendering' ? 'Cancel' : 'Close'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};