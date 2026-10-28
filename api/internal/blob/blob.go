// Package blob stores uploaded documents and generated PDFs.
package blob

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

var ErrNotFound = errors.New("blob not found")

type Store interface {
	Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error
	Get(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, key string) error
}

// FS keeps blobs on the local disk (dev).
type FS struct{ Dir string }

func (f FS) path(key string) (string, error) {
	p := filepath.Join(f.Dir, filepath.FromSlash(key))
	if !strings.HasPrefix(p, filepath.Clean(f.Dir)+string(os.PathSeparator)) {
		return "", errors.New("invalid key")
	}
	return p, nil
}

func (f FS) Put(_ context.Context, key string, r io.Reader, _ int64, _ string) error {
	p, err := f.path(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	tmp := p + ".tmp"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, r); err != nil {
		_ = out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

func (f FS) Get(_ context.Context, key string) (io.ReadCloser, error) {
	p, err := f.path(key)
	if err != nil {
		return nil, err
	}
	file, err := os.Open(p)
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotFound
	}
	return file, err
}

func (f FS) Delete(_ context.Context, key string) error {
	p, err := f.path(key)
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// S3 stores blobs in any S3-compatible service (MinIO, SeaweedFS, cloud S3).
type S3 struct {
	c      *minio.Client
	bucket string
}

func NewS3(ctx context.Context, endpoint, bucket, key, secret string) (*S3, error) {
	u, err := url.Parse(endpoint)
	if err != nil {
		return nil, err
	}
	c, err := minio.New(u.Host, &minio.Options{
		Creds: credentials.NewStaticV4(key, secret, ""), Secure: u.Scheme == "https",
	})
	if err != nil {
		return nil, err
	}
	ok, err := c.BucketExists(ctx, bucket)
	if err != nil {
		return nil, err
	}
	if !ok {
		if err := c.MakeBucket(ctx, bucket, minio.MakeBucketOptions{}); err != nil {
			return nil, err
		}
	}
	return &S3{c: c, bucket: bucket}, nil
}

func (s *S3) Put(ctx context.Context, key string, r io.Reader, size int64, ct string) error {
	_, err := s.c.PutObject(ctx, s.bucket, key, r, size, minio.PutObjectOptions{ContentType: ct})
	return err
}

func (s *S3) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	if _, err := s.c.StatObject(ctx, s.bucket, key, minio.StatObjectOptions{}); err != nil {
		if minio.ToErrorResponse(err).Code == "NoSuchKey" {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return s.c.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
}

func (s *S3) Delete(ctx context.Context, key string) error {
	return s.c.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{})
}

// ReadAll is a helper for small blobs such as PDFs.
func ReadAll(ctx context.Context, s Store, key string) ([]byte, error) {
	rc, err := s.Get(ctx, key)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rc.Close() }()
	var b bytes.Buffer
	_, err = io.Copy(&b, rc)
	return b.Bytes(), err
}
