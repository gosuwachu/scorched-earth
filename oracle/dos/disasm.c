// Read-only 16-bit disassembly with Borland floating-point escapes. Requires libcapstone.
#include <capstone/capstone.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
int main(int argc,char**argv){
 if(argc!=5){fprintf(stderr,"Usage: disasm SCORCH.EXE segment start end (hex)\n");return 2;}
 FILE*f=fopen(argv[1],"rb");if(!f){perror(argv[1]);return 1;}uint8_t b[500000];fread(b,1,sizeof b,f);fclose(f);
 unsigned seg=strtoul(argv[2],0,16), off=strtoul(argv[3],0,16), end=strtoul(argv[4],0,16);size_t base=0x6a00+(seg-0x1000)*16;
 csh h;cs_open(CS_ARCH_X86,CS_MODE_16,&h);
 while(off<end){uint8_t tmp[16];for(int i=0;i<16;i++)tmp[i]=b[base+off+i];int skip=0;
 if(tmp[0]==0xcd && tmp[1]>=0x34 && tmp[1]<=0x3b){tmp[1]+=0xa4;skip=1;}
 cs_insn*ins;size_t n=cs_disasm(h,tmp+skip,16-skip,off+skip,1,&ins);if(!n){printf("%04x: db %02x\n",off,b[base+off]);off++;continue;}
 printf("%04x: %-8s %s\n",off,ins[0].mnemonic,ins[0].op_str);off+=ins[0].size+skip;cs_free(ins,n);
 }cs_close(&h);
}
