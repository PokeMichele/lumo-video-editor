
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Download, CheckCircle, X } from "lucide-react";
import { TimelineItem } from "./VideoEditor";

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  timelineItems: TimelineItem[];
  totalDuration: number;
  aspectRatio: '16:9' | '4:3' | '9:16';
}

export const ExportDialog = ({ 
  isOpen, 
  onClose, 
  timelineItems, 
  totalDuration, 
  aspectRatio 
}: ExportDialogProps) => {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'preparing' | 'rendering' | 'completed' | 'error'>('preparing');
  const [exportedVideoUrl, setExportedVideoUrl] = useState<string | null>(null);

  // Simulate export process
  useEffect(() => {
    if (!isOpen) {
      setProgress(0);
      setStatus('preparing');
      setExportedVideoUrl(null);
      return;
    }

    const simulateExport = async () => {
      setStatus('preparing');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setStatus('rendering');
      
      // Simulate rendering progress
      for (let i = 0; i <= 100; i += 2) {
        setProgress(i);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      // Create a simple video blob (in a real implementation, this would be the actual video)
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      // Set canvas size based on aspect ratio
      const aspectRatios = {
        '16:9': { width: 1920, height: 1080 },
        '4:3': { width: 1440, height: 1080 },
        '9:16': { width: 1080, height: 1920 }
      };
      
      const dimensions = aspectRatios[aspectRatio];
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      
      if (ctx) {
        // Create a simple demo video frame
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.fillStyle = '#ffffff';
        ctx.font = '48px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Exported Video', canvas.width / 2, canvas.height / 2);
        ctx.fillText(`${aspectRatio}`, canvas.width / 2, canvas.height / 2 + 60);
        
        // Convert canvas to blob
        canvas.toBlob((blob) => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            setExportedVideoUrl(url);
            setStatus('completed');
            
            // Auto-download
            const link = document.createElement('a');
            link.href = url;
            link.download = `exported-video-${aspectRatio}-${Date.now()}.webp`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }
        }, 'image/webp');
      }
    };

    simulateExport().catch(() => {
      setStatus('error');
    });
  }, [isOpen, aspectRatio]);

  const handleClose = () => {
    if (exportedVideoUrl) {
      URL.revokeObjectURL(exportedVideoUrl);
    }
    onClose();
  };

  const getStatusText = () => {
    switch (status) {
      case 'preparing': return 'Preparing export...';
      case 'rendering': return 'Rendering video...';
      case 'completed': return 'Export completed!';
      case 'error': return 'Export failed';
      default: return 'Processing...';
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'preparing': return 'text-blue-500';
      case 'rendering': return 'text-yellow-500';
      case 'completed': return 'text-green-500';
      case 'error': return 'text-red-500';
      default: return 'text-gray-500';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="w-5 h-5" />
            Export Video
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Export Details */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Aspect Ratio:</span>
              <span className="font-medium">{aspectRatio}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Duration:</span>
              <span className="font-medium">{Math.round(totalDuration)}s</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Timeline Items:</span>
              <span className="font-medium">{timelineItems.length}</span>
            </div>
          </div>

          {/* Progress Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className={`text-sm font-medium ${getStatusColor()}`}>
                {getStatusText()}
              </span>
              {status === 'completed' && (
                <CheckCircle className="w-5 h-5 text-green-500" />
              )}
            </div>
            
            <Progress value={progress} className="w-full" />
            
            <div className="text-xs text-muted-foreground text-center">
              {progress}% completed
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-2">
            {status === 'completed' && exportedVideoUrl && (
              <Button
                onClick={() => {
                  const link = document.createElement('a');
                  link.href = exportedVideoUrl;
                  link.download = `exported-video-${aspectRatio}-${Date.now()}.webp`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }}
                variant="outline"
                size="sm"
              >
                <Download className="w-4 h-4 mr-2" />
                Download Again
              </Button>
            )}
            
            <Button
              onClick={handleClose}
              variant={status === 'completed' ? 'default' : 'outline'}
              size="sm"
              disabled={status === 'preparing' || status === 'rendering'}
            >
              {status === 'completed' ? 'Done' : 'Cancel'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
