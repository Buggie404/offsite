import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, forkJoin, map } from 'rxjs';

export interface CloudinaryUploadResult {
  url: string;
  public_id: string;
  type: 'image' | 'video';
}

@Injectable({ providedIn: 'root' })
export class CloudinaryService {

  private readonly cloudName = 'hvzqs6pf';
  private readonly uploadPreset = 'offsite_unsigned';

  constructor(private http: HttpClient) {}

  // Upload 1 file (ảnh hoặc video), tự nhận diện loại qua file.type
  uploadFile(file: File): Observable<CloudinaryUploadResult> {
    const resourceType: 'image' | 'video' = file.type.startsWith('video/') ? 'video' : 'image';
    const uploadUrl = `https://api.cloudinary.com/v1_1/${this.cloudName}/${resourceType}/upload`;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', this.uploadPreset);

    return this.http.post<any>(uploadUrl, formData).pipe(
      map(res => ({
        url: res.secure_url as string,
        public_id: res.public_id as string,
        type: resourceType
      }))
    );
  }

  // Upload nhiều file cùng lúc (song song), trả về mảng kết quả theo đúng thứ tự file truyền vào
  uploadMultiple(files: File[]): Observable<CloudinaryUploadResult[]> {
    if (files.length === 0) {
      return new Observable(subscriber => {
        subscriber.next([]);
        subscriber.complete();
      });
    }
    return forkJoin(files.map(file => this.uploadFile(file)));
  }
}