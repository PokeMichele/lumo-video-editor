import { useState, useRef, DragEvent } from "react";
import { Upload, File, Music, Video, Image as ImageIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MediaFile, TimelineItem } from "./VideoEditor";

interface FilesBrowserProps {
  files: MediaFile[];
  onFilesAdded: (files: MediaFile[]) => void;
  onItemAddedToTimeline: (item: TimelineItem) => void;
}

export const FilesBrowser = ({ files, onFilesAdded, onItemAddedToTimeline }: FilesBrowserProps) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const droppedFiles = Array.from(e.dataTransfer.files);
    processFiles(droppedFiles);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      processFiles(selectedFiles);
    }
  };

  const processFiles = async (fileList: File[]) => {
    const mediaFiles: MediaFile[] = [];
    
    for (const file of fileList) {
      if (file.type.startsWith('video/') || file.type.startsWith('audio/') || file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        let duration = 0;
        let type: 'video' | 'audio' | 'image' = 'video';
        
        if (file.type.startsWith('video/')) {
          type = 'video';
          duration = await getMediaDuration(url, file.type);
        } else if (file.type.startsWith('audio/')) {
          type = 'audio';
          duration = await getMediaDuration(url, file.type);
        } else if (file.type.startsWith('image/')) {
          type = 'image';
          duration = 3; // Default 3 seconds for images
        }
        
        const mediaFile: MediaFile = {
          id: `${Date.now()}-${Math.random()}`,
          name: file.name,
          type,
          url,
          duration,
          file
        };
        
        mediaFiles.push(mediaFile);
      }
    }
    
    onFilesAdded(mediaFiles);
  };

  const getMediaDuration = (url: string, type: string): Promise<number> => {
    return new Promise((resolve) => {
      const element = type.startsWith('video/') 
        ? document.createElement('video')
        : document.createElement('audio');
      
      element.src = url;
      element.onloadedmetadata = () => {
        resolve(element.duration || 0);
      };
      element.onerror = () => resolve(0);
    });
  };

  const handleAddToTimeline = (file: MediaFile) => {
    const newItem: TimelineItem = {
      id: `timeline-${Date.now()}-${Math.random()}`,
      mediaFile: file,
      startTime: 0,
      duration: file.duration,
      track: 0 // Default to first track
    };
    
    onItemAddedToTimeline(newItem);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-border">
        <h2 className="text-lg font-semibold text-foreground mb-4">Project Files</h2>
        
        {/* Drop Zone */}
        <Card 
          className={`p-6 border-2 border-dashed transition-colors cursor-pointer ${
            isDragOver 
              ? 'border-primary bg-primary/10' 
              : 'border-muted-foreground/25 hover:border-primary/50'
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="flex flex-col items-center text-center">
            <Upload className={`w-8 h-8 mb-2 ${isDragOver ? 'text-primary' : 'text-muted-foreground'}`} />
            <p className="text-sm text-muted-foreground">
              Drop video/audio/image files here or click to browse
            </p>
          </div>
        </Card>
        
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="video/*,audio/*,image/*"
          onChange={handleFileInput}
          className="hidden"
        />
      </div>

      {/* Files List */}
      <div className="flex-1 overflow-y-auto p-4">
        {files.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            No files imported yet
          </p>
        ) : (
          <div className="space-y-2">
            {files.map((file) => (
              <Card key={file.id} className="p-3 hover:bg-accent/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3 flex-1 min-w-0">
                    {file.type === 'video' ? (
                      <Video className="w-4 h-4 text-video-track flex-shrink-0" />
                    ) : file.type === 'audio' ? (
                      <Music className="w-4 h-4 text-audio-track flex-shrink-0" />
                    ) : (
                      <ImageIcon className="w-4 h-4 text-image-icon flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">
                        {file.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {Math.round(file.duration)}s
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleAddToTimeline(file)}
                    className="ml-2 flex-shrink-0"
                  >
                    Add
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};